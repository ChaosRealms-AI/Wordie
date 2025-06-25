import asyncio
import random
from pymongo import MongoClient, ASCENDING, DESCENDING
from fastapi import FastAPI, HTTPException, Request, Response
import datetime
from pytz import timezone
from bson import ObjectId
from typing import Dict, Optional, List, Union
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
import edge_tts
import io


# 计算文本中中文字符的数量
def count_chinese_chars(text):
    chinese_char_count = sum('\u4e00' <= char <= '\u9fff' for char in text)
    return chinese_char_count


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应更严格
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ====================== 配置模块 ======================
class Config:
    INITIAL_INTERVAL = 5 * 60  # 初始间隔（秒）
    DB_HOST = 'mongodb://localhost:27017/'
    USER_DB_NAME = 'word_learning_v7'
    USER_COLLECTION = 'user_words'
    TIMEZONE_UTC = timezone('UTC')
    LOG_COLLECTION = 'click_logs'
    MASTERED_DB_NAME = 'mastered_words_db'  # 新的数据库名
    MASTERED_COLLECTION = 'mastered_words'  # 新的集合名
    LAST_FIVE_WORDS_COLLECTION = 'last_five_words'  # 新增：存储前五个单词的集合名
    MAX_LAST_WORDS_COUNT = 15  # 最多存储 15 个单词


# ====================== 数据库模块 ======================
class DatabaseManager:
    def __init__(self):
        self.client = MongoClient(Config.DB_HOST)
        self.user_collection = self.client[Config.USER_DB_NAME][Config.USER_COLLECTION]
        self.log_collection = self.client[Config.USER_DB_NAME][Config.LOG_COLLECTION]
        self.mastered_collection = self.client[Config.MASTERED_DB_NAME][Config.MASTERED_COLLECTION]
        self.last_five_words_collection = self.client[Config.USER_DB_NAME][Config.LAST_FIVE_WORDS_COLLECTION]  # 新增
        # 连接源数据库和集合
        self.source_db = self.client['LLMGenSentence']
        self.source_collection = self.source_db['AllWords']

    def log_click_event(self, word_id, action):
        current_time = datetime.datetime.now()  # 使用naive datetime
        self.log_collection.insert_one({
            'word_id': word_id,
            'action': action,
            'timestamp': current_time
        })

    def save_mastered_word(self, word: Dict):
        # 确保保存到 mastered_words 集合的单词状态为 mastered
        word_to_save = word.copy()
        word_to_save['status'] = 'mastered'
        # 移除 _id 字段，防止更新时出现错误
        word_to_save.pop('_id', None)
        unique_key = {
            'word': word_to_save['word'],
            'phrase': word_to_save['phrase'],
        }
        print(unique_key)
        result = self.mastered_collection.update_one(unique_key, {'$set': word_to_save}, upsert=True)
        print(result)

    def mark_word_as_mastered(self, target_word: str):
        # 更新用户数据库中指定单词的所有条目的状态为 mastered
        self.user_collection.update_many(
            {'word': target_word},
            {'$set': {'status': 'mastered', 'next_review': None}}
        )

        # 同步到备份数据库
        words_to_sync = self.user_collection.find({'word': target_word})
        for word in words_to_sync:
            self.save_mastered_word(word)

    def update_last_five_words(self, word: Dict):
        # # 检查单词是否已存在
        # existing_word = self.last_five_words_collection.find_one({'word': word['word']})
        # if existing_word:
        #     return

        # 检查是否已有 15 个单词
        count = self.last_five_words_collection.count_documents({})
        if count >= Config.MAX_LAST_WORDS_COUNT:
            # 删除最早的单词
            oldest_word = self.last_five_words_collection.find_one(sort=[('order', ASCENDING)])
            self.last_five_words_collection.delete_one({'_id': oldest_word['_id']})

        # 获取最大的 order 值
        max_order = self.last_five_words_collection.find_one(sort=[('order', DESCENDING)])
        new_order = max_order['order'] + 1 if max_order else 1

        # 插入新单词
        self.last_five_words_collection.insert_one({
            'word': word['word'],
            'order': new_order
        })

    def get_last_five_words(self, current_word: str):
        # 按order降序取最新的6个单词
        recent_words = list(self.last_five_words_collection.find()
                            .sort('order', DESCENDING)
                            .limit(6))  # 取最新的6个

        # 提取单词列表并过滤当前单词
        filtered_words = [word['word'] for word in recent_words if word['word'] != current_word]

        # 确保最多返回5个单词
        return filtered_words[:5]

    def mark_word_as_bad(self, word_id: ObjectId):
        # 将指定单词的状态标注为【不好】
        self.user_collection.update_one(
            {'_id': word_id},
            {'$set': {'status': 'bad', 'next_review': None}}
        )

    def get_today_learning_count(self):
        utc_offset = datetime.timedelta(hours=8)
        today_start = datetime.datetime.utcnow() + utc_offset
        today_start = datetime.datetime(today_start.year, today_start.month, today_start.day, 0, 0, 0)
        today_end = datetime.datetime(today_start.year, today_start.month, today_start.day, 23, 59, 59)
        today_logs_query = {
            "timestamp": {
                "$gte": today_start,
                "$lte": today_end
            }
        }
        return self.log_collection.count_documents(today_logs_query)

    def get_syllables(self, word):
        doc = self.source_collection.find_one({'word': word})
        return doc.get('syllables') if doc else None

    def get_pending_review_count(self):
        """获取待复习的旧词数量"""
        current_time = datetime.datetime.now()  # 使用naive datetime
        return self.user_collection.count_documents(
            {'status': 'reviewing', 'next_review': {'$lte': current_time}}
        )


# ====================== 学习系统模块 ======================
class LearningSystem:
    def __init__(self, db: DatabaseManager):
        self.db = db
        self.current_word: Optional[Dict] = None

    def get_next_word(self, review_mode: str) -> Optional[Dict]:
        global stage
        random_num = random.randint(0, 1)

        current_time = datetime.datetime.now()  # 使用naive datetime
        # 统计待复习的新词和旧词数量
        new_words_count = self.db.user_collection.count_documents({'status': 'new'})
        reviewing_words_count = self.db.get_pending_review_count()
        print(f"待学习的新词数量: {new_words_count}，待复习的旧词数量: {reviewing_words_count}")

        if review_mode == "old_mode":
            print('1111111111111111111111111111111111')
            if word := self._get_urgent_review(current_time):
                self.current_word = word
            elif word := self._get_new_word():
                self.current_word = word
            else:
                return None
        elif review_mode == "new_today_only":
            print(22222222222222222222222222222222222222)
            if word := self._get_urgent_review_today(current_time):
                self.current_word = word
            elif word := self._get_new_word():
                self.current_word = word
            else:
                return None
        else:
            raise HTTPException(status_code=400, detail="Invalid review mode")

        formatted_word = self._format_word(self.current_word)
        last_five_words = self.db.get_last_five_words(self.current_word['word'])
        formatted_word['last_five_words'] = last_five_words

        # 获取今日学习的总计数
        today_learning_count = self.db.get_today_learning_count()
        formatted_word['today_learning_count'] = today_learning_count

        # 获取音节信息
        formatted_word['syllables'] = self.db.get_syllables(self.current_word['word'])

        # 获取待复习的旧词数量
        formatted_word['pending_review_count'] = reviewing_words_count

        return formatted_word

    def handle_response(self, response: str) -> Dict:
        if not self.current_word:
            raise HTTPException(status_code=400, detail="No current word")

        # 每次提交响应后更新最近学习的单词
        self.db.update_last_five_words(self.current_word)

        current_time = datetime.datetime.now()  # 使用naive datetime
        handler = {
            'remember': self._handle_remember,
            'forget': self._handle_forget,
            'master': self._handle_master
        }.get(response)

        if not handler:
            raise HTTPException(status_code=400, detail="Invalid response")

        self.db.log_click_event(self.current_word['_id'], response)
        update_data = handler(self.current_word, current_time)

        # 记录首次学习日期
        if 'first_learn_date' not in self.current_word:
            update_data['first_learn_date'] = current_time

        # 更新连续正确次数
        if response == 'remember':
            consecutive_count = self.current_word.get('consecutive_remember_count', 0) + 1
            update_data['consecutive_remember_count'] = consecutive_count
            if consecutive_count == 20:
                update_data['status'] = 'mastered'
                self.db.save_mastered_word(self.current_word)
        else:
            update_data['consecutive_remember_count'] = 0

        self._update_word(self.current_word['_id'], update_data)

        return {"status": "complete"}

    def _get_urgent_review(self, current_time: datetime.datetime) -> Optional[Dict]:
        print(self.db.user_collection.find_one(
            {'status': 'reviewing', 'next_review': {'$lte': current_time}},
            sort=[('next_review', DESCENDING)]
        ))

        return self.db.user_collection.find_one(
            {'status': 'reviewing', 'next_review': {'$lte': current_time}},
            sort=[('next_review', DESCENDING)]
        )

    def _get_urgent_review_today(self, current_time: datetime.datetime) -> Optional[Dict]:
        utc_offset = datetime.timedelta(hours=8)
        today_start = datetime.datetime.utcnow() + utc_offset
        today_start = datetime.datetime(today_start.year, today_start.month, today_start.day, 0, 0, 0)
        today_end = datetime.datetime(today_start.year, today_start.month, today_start.day, 23, 59, 59)
        return self.db.user_collection.find_one(
            {'status': 'reviewing', 'next_review': {'$lte': current_time},
             'first_learn_date': {'$gte': today_start, '$lte': today_end}},
            sort=[('next_review', DESCENDING)]
        )

    def _get_new_word(self) -> Optional[Dict]:
        # 每次都查询数据库，取第一个状态为 'new' 的单词
        return self.db.user_collection.find_one({'status': 'new'})

    def _handle_remember(self, word: Dict, current_time: datetime.datetime) -> Dict:
        new_interval = word['interval'] * 2
        return {
            'status': 'reviewing',
            'interval': new_interval,
            'next_review': current_time + datetime.timedelta(seconds=new_interval)
        }

    def _handle_forget(self, word: Dict, current_time: datetime.datetime) -> Dict:
        return {
            'status': 'reviewing',
            'interval': Config.INITIAL_INTERVAL,
            'next_review': current_time + datetime.timedelta(seconds=Config.INITIAL_INTERVAL)
        }

    def _handle_master(self, word: Dict, current_time: datetime.datetime) -> Dict:
        self.db.save_mastered_word(word)  # 保存标熟数据
        return {'status': 'mastered', 'next_review': None}

    def _update_word(self, word_id: ObjectId, update_data: Dict):
        self.db.user_collection.update_one(
            {'_id': word_id},
            {'$set': update_data, '$inc': {'reviews': 1}}
        )

    def _format_word(self, word: Dict) -> Dict:
        reviews = word.get("reviews", 0)
        wins = self._calculate_wins(word["_id"])
        win_rate = wins / reviews if reviews > 0 else 0

        # # 判断使用哪个例句列表
        # if 'latest_example_sens' in word and word['latest_example_sens']:
        #     examples = [{"text": ex["text"], "translation": ex["translation"]} for ex in word['latest_example_sens']]
        # else:
        #     examples = [{"text": ex["text"], "translation": ex["translation"]} for ex in
        #                 word.get("example_sentences", [])]

        return {
            "id": str(word["_id"]),
            "word": word["word"],
            "word_meaning": word.get("cn_word_meaning"),  # 新增
            "phrase": word["phrase"],
            "phrase_meaning": word.get("phrase_meaning"),  # 新增
            "line_number": word.get("line_number"),
            "examples": word.get("V2_examples", []),
            "status": word["status"],
            "reviews": reviews,
            "win_rate": win_rate,
            "number": word.get("number", 0),
            "consecutive_remember_count": word.get('consecutive_remember_count', 0),
            "last_five_words": [],  # 这里先置空，后续在 get_next_word 中填充
            "today_learning_count": 0,  # 先置空，后续在 get_next_word 中填充
            "syllables": None,  # 先置空，后续在 get_next_word 中填充
            "first_learn_date": word.get("first_learn_date"),  # 新增
            "pending_review_count": 0  # 先置空，后续在 get_next_word 中填充
        }

    def _calculate_wins(self, word_id):
        logs = self.db.log_collection.find({'word_id': word_id})
        wins = 0
        for log in logs:
            if log['action'] in ['remember', 'master']:
                wins += 1
        return wins


# ====================== FastAPI应用 ======================
db_manager = DatabaseManager()
learning_system = LearningSystem(db_manager)


class UserResponse(BaseModel):
    word_id: str
    action: str  # remember/forget/master


# 新的 Pydantic 模型，用于接收要标熟的单词
class MarkWordAsMasteredRequest(BaseModel):
    word: str


# 新的 Pydantic 模型，用于接收要标注为【不好】的单词 ID
class MarkWordAsBadRequest(BaseModel):
    word_id: str


# ====================== 响应模型定义 ======================
class ExampleSentence(BaseModel):
    text: str = Field(..., description="例句文本")
    translation: str = Field(..., description="例句翻译")


class WordResponse(BaseModel):
    id: str = Field(..., description="单词唯一ID")
    word: str = Field(..., description="单词拼写")
    word_meaning: Optional[str] = Field(None, description="单词翻译")  # 新增
    phrase: Optional[str] = Field(None, description="短语信息")
    phrase_meaning: Optional[str] = Field(None, description="短语翻译")  # 新增
    line_number: Optional[int] = Field(None, description="行号")
    examples: List[ExampleSentence] = Field(..., description="例句列表")
    status: str = Field(..., description="当前学习状态")
    reviews: int = Field(..., description="学习次数")
    win_rate: float = Field(..., description="胜率")
    number: int = Field(..., description="单词编号")
    consecutive_remember_count: int = Field(0, description="连续正确次数")  # 添加连续正确次数字段
    last_five_words: List[str] = Field([], description="上五个学习的单词")  # 修改为上五个
    today_learning_count: int = Field(0, description="今日学习的总计数")
    syllables: Optional[str] = Field(None, description="单词音节")
    first_learn_date: Optional[datetime.datetime] = Field(None, description="首次学习日期")  # 新增
    pending_review_count: int = Field(0, description="待复习的旧词数量")  # 新增


class CompleteStatus(BaseModel):
    status: str = Field(..., description="学习完成状态")


class StatsResponse(BaseModel):
    mastered: int = Field(..., description="已掌握单词数")
    reviewing: int = Field(..., description="复习中单词数")
    new: int = Field(..., description="新单词数量")
    pending_review: int = Field(..., description="待复习的旧词数量")  # 新增


# ====================== FastAPI端点修改 ======================
@app.get("/next-word",
         summary="获取下一个学习单词",
         response_model=Union[WordResponse, CompleteStatus])
def get_next_word(review_mode: str):
    """获取下一个需要学习的单词"""
    if word := learning_system.get_next_word(review_mode):
        return word
    return {"status": "complete"}


@app.post("/submit-response",
          summary="提交用户响应",
          response_model=Union[WordResponse, CompleteStatus])
def submit_response(response: UserResponse):
    """处理用户响应并返回下一个单词"""
    try:
        ObjectId(response.word_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid word ID")

    return learning_system.handle_response(response.action)


# 生成音频流的路由
@app.get("/generate_audio")
async def generate_audio(request: Request):
    print('请求语音接口')
    text = request.query_params.get('text', "Hello, world!").replace('**', '')
    chinese_ratio = sum('\u4e00' <= char <= '\u9fff' for char in text) / len(text) if text else 0
    voice = "zh-CN-XiaoxiaoNeural" if chinese_ratio > 0.5 else "en-GB-LibbyNeural"

    max_retries = 3
    retries = 0
    while retries < max_retries:
        try:
            audio_buffer = io.BytesIO()
            async for chunk in edge_tts.Communicate(text, voice).stream():
                if chunk["type"] == "audio":
                    audio_buffer.write(chunk["data"])

            audio_buffer.seek(0)
            return Response(audio_buffer.getvalue(), media_type='audio/mpeg')
        except:
            retries += 1
            print(retries, '重试中')
            if retries < max_retries:
                await asyncio.sleep(2)  # 等待2秒后重试
            else:
                raise HTTPException(status_code=503, detail="Failed to generate audio after multiple attempts.")


# 新的接口：将指定单词标熟
@app.post("/mark-word-as-mastered", summary="将指定单词标熟")
def mark_word_as_mastered(request: MarkWordAsMasteredRequest):
    db_manager.mark_word_as_mastered(request.word)
    return {"message": f"单词 {request.word} 的所有条目已标熟"}


# 新的接口：将指定单词标注为【不好】
@app.post("/mark-word-as-bad", summary="将指定单词标注为【不好】")
def mark_word_as_bad(request: MarkWordAsBadRequest):
    try:
        word_id = ObjectId(request.word_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid word ID")

    db_manager.mark_word_as_bad(word_id)
    return {"message": f"单词 ID 为 {request.word_id} 的条目已标注为【不好】"}


# 新增接口：获取待复习的旧词数量
@app.get("/stats", summary="获取学习统计信息", response_model=StatsResponse)
def get_stats():
    """获取学习统计信息，包括待复习的旧词数量"""
    current_time = datetime.datetime.now(Config.TIMEZONE_UTC)

    # 计算各种状态的单词数量
    mastered_count = db_manager.user_collection.count_documents({'status': 'mastered'})
    reviewing_count = db_manager.user_collection.count_documents({'status': 'reviewing'})
    new_count = db_manager.user_collection.count_documents({'status': 'new'})

    # 计算待复习的旧词数量
    pending_review_count = db_manager.get_pending_review_count()

    return {
        'mastered': mastered_count,
        'reviewing': reviewing_count,
        'new': new_count,
        'pending_review': pending_review_count
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)