import json
import os
from pymongo import MongoClient
from bson import ObjectId, Decimal128
from datetime import datetime

# 数据库配置
DB_HOST = 'mongodb://localhost:27017/'
USER_DB_NAME = 'word_learning_v5'
INPUT_DIR = 'mongo_export'  # 导入文件所在目录


class MongoDecoder(json.JSONDecoder):
    """自定义JSON解码器，处理MongoDB特殊类型"""

    def __init__(self, *args, **kwargs):
        super().__init__(object_hook=self.object_hook, *args, **kwargs)

    def object_hook(self, dct):
        # 处理ObjectId
        if '_id' in dct and isinstance(dct['_id'], str):
            try:
                dct['_id'] = ObjectId(dct['_id'])
            except:
                pass

        # 处理日期时间（如果有特定格式标识）
        for key, value in dct.items():
            if isinstance(value, str):
                # 简单判断ISO格式日期（可根据实际情况扩展）
                if value.endswith('Z') and len(value) == 20:
                    try:
                        dct[key] = datetime.fromisoformat(value.replace('Z', '+00:00'))
                    except:
                        pass
                # 处理其他可能的类型...

        return dct


def import_json_to_mongodb():
    """从JSON文件导入数据到MongoDB"""
    # 连接MongoDB
    client = MongoClient(DB_HOST)
    db = client[USER_DB_NAME]

    # 检查输入目录是否存在
    if not os.path.exists(INPUT_DIR):
        print(f"错误: 目录 '{INPUT_DIR}' 不存在")
        return

    # 获取所有JSON文件
    json_files = [f for f in os.listdir(INPUT_DIR) if f.endswith('.json')]

    # 逐个导入JSON文件
    for json_file in json_files:
        file_path = os.path.join(INPUT_DIR, json_file)
        collection_name = os.path.splitext(json_file)[0]

        try:
            # 读取JSON文件
            with open(file_path, 'r', encoding='utf-8') as f:
                documents = json.load(f, cls=MongoDecoder)

            # 获取集合
            collection = db[collection_name]

            # 清空现有数据（如果有）
            collection.delete_many({})

            # 导入数据
            if documents:
                if isinstance(documents, list):
                    collection.insert_many(documents)
                else:
                    collection.insert_one(documents)
                print(f"已导入集合: {collection_name}，共 {len(documents)} 条记录")
            else:
                print(f"已导入集合: {collection_name}，空集合")

        except Exception as e:
            print(f"导入失败: {collection_name}，错误: {str(e)}")

    # 关闭数据库连接
    client.close()
    print(f"所有JSON文件已导入到数据库: {USER_DB_NAME}")


if __name__ == "__main__":
    import_json_to_mongodb()