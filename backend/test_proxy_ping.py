import requests
import sys

# 代理设置 - 使用HTTP代理
proxies = {
    'http': 'http://127.0.0.1:1080',
    'https': 'http://127.0.0.1:1080',
}

try:
    print("正在测试代理连接...")
    resp = requests.get('https://www.google.com', proxies=proxies, timeout=10)
    print(f"✅ 连接成功!")
    print(f"状态码: {resp.status_code}")
    print(f"页面标题: {resp.text.split('<title>')[1].split('</title>')[0] if '<title>' in resp.text else '无法获取标题'}")
except Exception as e:
    print(f"❌ 连接失败: {e}")
    sys.exit(1)