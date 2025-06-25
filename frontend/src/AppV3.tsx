import { useState, useEffect, useRef } from 'react';
import './App.css';

// 定义例句接口
interface ExampleSentence {
    text: string;
    translation: string;
}

// 定义单词接口，添加 syllables 字段
interface Word {
    id: string;
    word: string;
    word_meaning: string;
    phrase: string | null;
    phrase_meaning: string | null;
    english: string | null;
    chinese: string | null;
    coca_rank: number | null;
    examples: ExampleSentence[];
    status: 'new' | 'reviewing' | 'mastered';
    reviews: number;
    win_rate: number;
    audio_file: string;
    last_five_words: string[];
    line_number: number | null;
    consecutive_remember_count: number;
    today_learning_count: number; // 新增字段
    syllables: string; // 新增字段
    pending_review_count: number; // 新增字段
}

// 全局音频缓存
const audioCache = new Map();

function App() {
    // 定义状态变量
    const [currentWord, setCurrentWord] = useState<Word | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
    const [translation, setTranslation] = useState<string | null>(null);
    const [exampleTranslations, setExampleTranslations] = useState<{ [key: string]: string }>({});
    const [showPopup, setShowPopup] = useState(false);
    const [popupUrl, setPopupUrl] = useState('');
    const [showWord, setShowWord] = useState(true); // 修改为默认显示
    const [isLooping, setIsLooping] = useState(false);
    const [learnedWordCount, setLearnedWordCount] = useState(0);
    // 新增状态，用于控制例句、英文和短语的显示
    const [showExamplesAndPhrase, setShowExamplesAndPhrase] = useState(true); // 修改为默认显示
    // 新增状态，用于控制翻译和例句翻译的显示
    const [showTranslationFlag, setShowTranslationFlag] = useState(false);
    const [showExampleTranslationsFlag, setShowExampleTranslationsFlag] = useState(false);

    // 使用 ref 跟踪循环状态
    const isLoopingRef = useRef(isLooping);

    useEffect(() => {
        isLoopingRef.current = isLooping;
    }, [isLooping]);

    // 随机打乱数组的函数
    const shuffleArray = (array: ExampleSentence[]) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    };

    // 获取下一个单词
    const fetchNextWord = async () => {
        stopLooping();
        const nextWordUrl = `/api/next-word?review_mode=old_mode`;
        setIsLoading(true);
        setError(null);
        setTranslation(null);
        setExampleTranslations({});
        setShowTranslationFlag(false);
        setShowExampleTranslationsFlag(false);
        // 保持单词和例句默认显示
        // setShowWord(false); // 注释掉这行
        // setShowExamplesAndPhrase(false); // 注释掉这行
        try {
            const response = await fetch(nextWordUrl, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `请求失败: ${response.status}`);
            }

            const rawData = await response.json();

            if (rawData.status === 'complete') {
                setCurrentWord(null);
                return;
            }

            let examples = rawData.examples || [];
            // 随机打乱例句数组
            examples = shuffleArray(examples);
            // 取前三个例句
            examples = examples.slice(0, 3);

            const formattedWord: Word = {
                id: rawData.id,
                word: rawData.word,
                word_meaning: rawData.word_meaning,
                phrase: rawData.phrase,
                phrase_meaning: rawData.phrase_meaning,
                // 把单词的中文解释放在英文解释位置
                english: rawData.word_meaning || '暂无中文解释',
                // 把词组的中文解释放在中文解释位置
                chinese: rawData.phrase_meaning || '暂无中文解释',
                coca_rank: rawData.coca_rank,
                examples: examples,
                status: rawData.status,
                reviews: rawData.reviews,
                win_rate: rawData.win_rate,
                audio_file: rawData.audio_file,
                last_five_words: rawData.last_five_words || [],
                line_number: rawData.line_number,
                consecutive_remember_count: rawData.consecutive_remember_count,
                today_learning_count: rawData.today_learning_count, // 解析新增字段
                syllables: rawData.syllables, // 解析新增字段
                pending_review_count: rawData.pending_review_count // 解析新增字段

            };

            setCurrentWord(formattedWord);
            setLearnedWordCount(prevCount => prevCount + 1);
        } catch (err) {
            console.error('请求失败:', err);
            setError(err instanceof Error ? err.message : '网络请求失败');
        } finally {
            setIsLoading(false);
        }
    };

    // 提交单词学习状态
    const handleSubmit = async (actionType: 'forget' | 'remember' | 'master') => {
        stopLooping();
        if (!currentWord) return;
        const submitResponseUrl = '/api/submit-response';
        try {
            const response = await fetch(submitResponseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    word_id: currentWord.id,
                    action: actionType,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || '请求失败');
            }

            await fetchNextWord();
        } catch (err) {
            console.error('提交失败:', err);
            setError(err instanceof Error ? err.message : '提交失败');
        }
    };

    // 播放音频
    const playAudio = async (text: string) => {
        if (audioElement) {
            audioElement.pause();
            audioElement.currentTime = 0;
        }
        try {
            let audioUrl;
            if (audioCache.has(text)) {
                audioUrl = audioCache.get(text);
            } else {
                const response = await fetch(`/api/generate_audio?text=${encodeURIComponent(text)}`, {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });

                const audioBlob = await response.blob();
                audioUrl = URL.createObjectURL(audioBlob);
                audioCache.set(text, audioUrl);
            }

            const newAudio = new Audio(audioUrl);
            newAudio.addEventListener('ended', () => {
                if (isLoopingRef.current) {
                    newAudio.play();
                }
            });
            try {
                await newAudio.play();
            } catch (playError) {
                console.error('播放音频出错:', playError);
            }
            setAudioElement(newAudio);
        } catch (err) {
            console.error('音频生成失败:', err);
            setError(err instanceof Error ? err.message : '音频生成失败');
        }
    };

    // 展示或隐藏翻译和例句翻译
    const toggleTranslationAndExamples = () => {
        if (currentWord) {
            const eng = currentWord.english || '暂无中文解释';
            const chi = currentWord.chinese || '暂无中文解释';
            setTranslation(`${eng}\n${chi}`);
            const newExampleTranslations: { [key: string]: string } = {};
            currentWord.examples.forEach(example => {
                newExampleTranslations[example.text] = example.translation || '暂无翻译';
            });
            setExampleTranslations(newExampleTranslations);
            setShowTranslationFlag(!showTranslationFlag);
            setShowExampleTranslationsFlag(!showExampleTranslationsFlag);
        }
    };

    // 播放第一个例句的中文翻译
    const playFirstExampleTranslation = () => {
        if (currentWord && currentWord.examples.length > 0) {
            const firstExampleTranslation = currentWord.examples[0].translation || '暂无翻译';
            playAudio(firstExampleTranslation);
        }
    };

    // 高亮例句中的当前单词
    const getHighlightedExample = (text: string, word: string) => {
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b(${escapedWord})\\b`, 'gi');
        return text.replace(regex, '<span style="color: red">$1</span>');
    };

    // 将例句中 ** 包裹的内容显示为加粗
    const boldifyText = (text: string) => {
        return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    };

    // 打开或关闭图片弹窗
    const toggleImagePopup = () => {
        if (currentWord) {
            if (showPopup) {
                console.log('Closing popup');
                setShowPopup(false);
            } else {
                console.log('Opening popup');
                const baseUrl = 'https://cn.bing.com/images/search?';
                const word = encodeURIComponent(currentWord.word);
                const params = `q=${word}&first=1&form=BESBTB&ensearch=1`;
                const fullUrl = `${baseUrl}${params}`;
                setPopupUrl(fullUrl);
                setShowPopup(true);
            }
        }
    };

    // 关闭弹窗
    const closePopup = () => {
        setShowPopup(false);
    };

    // 停止循环播放
    const stopLooping = () => {
        setIsLooping(false);
        if (audioElement) {
            audioElement.pause();
            audioElement.currentTime = 0;
        }
    };

    // 将指定单词标注为【不好】
    const markWordAsBad = async () => {
        if (!currentWord) return;
        const markUrl = '/api/mark-word-as-bad';
        try {
            const response = await fetch(markUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    word_id: currentWord.id
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || '请求失败');
            }

            await fetchNextWord();
        } catch (err) {
            console.error('标注失败:', err);
            setError(err instanceof Error ? err.message : '标注失败');
        }
    };

    // 播放第一个例句
    const playFirstExample = () => {
        if (currentWord && currentWord.examples.length > 0) {
            const firstExample = currentWord.examples[0].text;
            playAudio(firstExample);
        }
    };

    // 播放单词的中文解释
    const playWordChineseMeaning = () => {
        if (currentWord) {
            const meaning = currentWord.english || '暂无中文解释';
            playAudio(meaning);
        }
    };

    // 组件挂载时获取下一个单词
    useEffect(() => {
        fetchNextWord();
        return () => {
            stopLooping();
            if (audioElement) {
                audioElement.pause();
                audioElement.src = '';
            }
            audioCache.clear();
        };
    }, []);

    // // 自动播放第一个例句
    // useEffect(() => {
    //     if (currentWord && currentWord.examples.length > 0) {
    //         const firstExample = currentWord.examples[0].text;
    //         playAudio(firstExample);
    //     }
    // }, [currentWord]);

    // 监听键盘事件
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            console.log('Key pressed:', event.key);
            switch (event.key) {
                case '1':
                    handleSubmit('remember');
                    break;
                case '9':
                    handleSubmit('forget');
                    break;
                case '2':
                    setShowWord(!showWord);
                    setShowExamplesAndPhrase(!showExamplesAndPhrase);
                    break;
                case '3':
                    toggleTranslationAndExamples();
                    break;
                case '4':
                    playFirstExampleTranslation();
                    break;
                case '5':
                    playWordChineseMeaning();
                    break;
                case '6':
                    toggleImagePopup();
                    break;
                case '7':
                    if (currentWord) {
                        playAudio(currentWord.word);
                    }
                    break;
                case '8':
                    playFirstExample();
                    break;
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [currentWord, showWord, showExamplesAndPhrase, translation, exampleTranslations, isLooping, audioElement, showTranslationFlag, showExampleTranslationsFlag]);

    // 渲染错误信息
    if (error) {
        return (
            <div className="container">
                <div className="error-box">
                    <div>⚠️ {error}</div>
                    <button className="retry-btn" onClick={fetchNextWord}>
                        重试
                    </button>
                </div>
            </div>
        );
    }

    // 渲染加载状态
    if (isLoading) {
        return (
            <div className="container">
                <div className="loading">
                    <div className="loader"></div>
                    <div>加载中...</div>
                </div>
            </div>
        );
    }

    // 渲染学习完成状态
    if (!currentWord) {
        return (
            <div className="container">
                <div className="complete-box">
                    <h2>🎉 今日学习已完成</h2>
                    <button className="review-btn" onClick={fetchNextWord}>
                        复习单词
                    </button>
                </div>
            </div>
        );
    }

    const lastFiveWordsText = currentWord.last_five_words.join(' || ');
    const canShowReview = learnedWordCount % 5 === 0 && learnedWordCount > 0;

    return (
        <div className="container">
            <div className="left-button-group3">
                <button className="btn bad" onClick={markWordAsBad}>
                    【不好】
                </button>
                <button className="btn bad" onClick={() => handleSubmit('master')}>
                    已掌握
                </button>
            </div>

            <div className="left-button-group2">
                {/* 新增合并按钮 */}
                <button className="btn remember" onClick={() => {
                    setShowWord(!showWord);
                    setShowExamplesAndPhrase(!showExamplesAndPhrase);
                }}>
                    <i className="fas fa-eye"></i> {showWord || showExamplesAndPhrase ? '隐藏' : '显示'} 2
                </button>
            </div>

            <div className="left-button-group4">
                <button className="btn remember" onClick={toggleTranslationAndExamples}>
                    <i className="fas fa-language"></i> {showTranslationFlag || showExampleTranslationsFlag ? '隐藏' : '显示'} 3
                </button>
                <button className="btn remember" onClick={playFirstExampleTranslation}>
                    <i className="fas fa-volume-up"></i> 播放第一个句子的中文 4
                </button>
            </div>

            <div className="left-button-group">
                <button className="btn remember" onClick={() => handleSubmit('remember')}>
                    🧠 还记得 1
                </button>
            </div>

            <div className="right-button-group">
                <button className="btn forget" onClick={() => handleSubmit('forget')}>
                    🤔 不认识 9
                </button>
            </div>

            <div className="stats-container">
                <p>今日学习单词数: {currentWord.today_learning_count}</p>
                <p>待复习单词数: {currentWord?.pending_review_count || 0}</p>
            </div>

                <div className="card">
                    <div className="word-translation-container">
                        <h1
                            className="word"
                            onClick={() => playAudio(currentWord.word)}
                            style={{visibility: showWord ? 'visible' : 'hidden'}}
                        >
                            {currentWord.word}
                        </h1>

                        <h1
                            className="word2"
                            onClick={() => {
                                if (currentWord.phrase) {
                                    playAudio(currentWord.phrase);
                                }
                            }}
                            style={{visibility: showExamplesAndPhrase ? 'visible' : 'hidden'}}
                        >
                            {currentWord.phrase}
                        </h1>

                        <p className="translation smaller-font"
                           style={{visibility: showTranslationFlag ? 'visible' : 'hidden', minHeight: '2em'}}>
                            {translation ? translation.split('\n').join(' | ') : ''}
                        </p>
                    </div>

                    <div className="example-translation-container"
                         style={{display: showExamplesAndPhrase ? 'block' : 'none'}}>
                        {canShowReview && (
                            <div
                                className="example"
                                onClick={() => playAudio(lastFiveWordsText)}
                            >
                            </div>
                        )}

                        {currentWord.examples.length > 0 ? (
                            currentWord.examples.map((example, index) => (
                                <div key={index} className="example-container">
                                    <div
                                        className="example"
                                        onClick={() => playAudio(example.text)}
                                    >
                                    <span
                                        dangerouslySetInnerHTML={{
                                            __html: boldifyText(getHighlightedExample(
                                                example.text,
                                                currentWord.word
                                            ))
                                        }}
                                    />
                                    </div>
                                    <div className="example-translation smaller-font" style={{
                                        visibility: showExampleTranslationsFlag && exampleTranslations[example.text] ? 'visible' : 'hidden',
                                        minHeight: '1.5em'
                                    }}>
                                    <span className="translation" dangerouslySetInnerHTML={{
                                        __html: exampleTranslations[example.text] || ''
                                    }}/>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="no-example">⚠️ 该单词暂无例句</div>
                        )}
                    </div>
                </div>


                <button className="btn master fixed-master-button" style={{bottom: '140px'}}
                        onClick={playWordChineseMeaning}>
                    【播放单词的中文解释】 5
                </button>

                <button className="btn master fixed-master-button" style={{bottom: '80px'}}
                        onClick={toggleImagePopup}>
                    {showPopup ? '【收起图片】' : '【查看图片】'} 6
                </button>

                <button className="btn master fixed-master-button" style={{bottom: '20px'}}
                        onClick={() => {
                            if (currentWord) {
                                playAudio(currentWord.word);
                            }
                        }}>
                    【播放单词】 7
                </button>

                <button className="btn master fixed-master-button" style={{bottom: '200px'}}
                        onClick={playFirstExample}>
                    【播放第一个例句】 8
                </button>

                {showPopup && (
                    <div className="popup-overlay" onClick={closePopup}>
                        <div className="popup-content" onClick={(e) => e.stopPropagation()}>
                            <iframe
                                src={popupUrl}
                                width="100%"
                                height="100%"
                                frameBorder="0"
                            ></iframe>
                        </div>
                    </div>
                )}
            </div>
            );
            }

            export default App;