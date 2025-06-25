#!/bin/bash

echo "🚀 启动 Learn_EN_APP 项目..."

# 启动后端服务
echo "🔧 启动后端服务..."
cd backend
source venv/bin/activate
python app.py &
BACKEND_PID=$!
cd ..

# 启动前端服务
echo "🎨 启动前端服务..."
cd frontend
pnpm dev &
FRONTEND_PID=$!
cd ..

echo "✅ 服务启动完成！"
echo "📱 前端地址: http://localhost:5173"
echo "🔧 后端地址: http://localhost:8000"
echo "💡 按 Ctrl+C 停止所有服务"

# 等待用户中断
trap 'echo "🛑 正在停止服务..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo "✅ 服务已停止"; exit 0' INT

# 保持脚本运行
wait 