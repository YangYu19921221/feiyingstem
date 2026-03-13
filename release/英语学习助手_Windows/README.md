# 英语学习助手 - Windows 安装说明

## 📋 系统要求

- **操作系统**: Windows 10 / Windows 11
- **Python**: 3.8 或更高版本
- **硬盘空间**: 至少 500MB 可用空间
- **浏览器**: Chrome / Edge / Firefox (推荐 Chrome)

## 🚀 快速开始

### 第一步：安装 Python

如果您的电脑尚未安装 Python，请按以下步骤操作：

1. 访问 Python 官网下载页面: https://www.python.org/downloads/
2. 下载最新版本的 Python 3.x
3. 运行安装程序时，**务必勾选** "Add Python to PATH" 选项
4. 完成安装后，重启电脑

验证安装：打开命令提示符（cmd），输入以下命令：
```
python --version
```
如果显示版本号（如 `Python 3.11.x`），则安装成功。

### 第二步：安装依赖

双击运行 `安装依赖.bat`，等待自动完成以下操作：
- 创建 Python 虚拟环境
- 安装所需依赖包（使用清华镜像加速）

安装过程大约需要 2-5 分钟，取决于网络速度。

### 第三步：启动服务

双击运行 `启动服务.bat`，看到以下���示表示启动成功：
```
[提示] 后端API地址: http://localhost:8000
[提示] 前端页面地址: http://localhost:8000
```

### 第四步：访问系统

打开浏览器，访问: **http://localhost:8000**

## 📝 默认账号

系统预置了以下测试账号：

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 学生 | student | 123456 |
| 教师 | teacher | 123456 |

## 🔧 高级配置

### AI 功能配置（可选）

如需使用 AI 辅助功能（智能生成例句、释义等），请编辑 `backend\.env` 文件：

```ini
# OpenAI 配置
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4-turbo-preview

# 或者使用 Claude
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-3-sonnet-20240229
```

> 注意：AI 功能是可选的，即使不配置也可以正常使用系统的其他功能。

### 端口配置

默认使用 8000 端口。如果端口被占用，可以编辑 `启动服务.bat`，修改最后一行的端口号。

## ❓ 常见问题

### Q1: 双击 .bat 文件闪退？

**解决方案**：
1. 右键点击 .bat 文件，选择"以管理员身份运行"
2. 或者打开命令提示符，手动运行脚本

### Q2: 提示"未检测到 Python"？

**解决方案**：
1. 确认已安装 Python 3.8+
2. 安装时是否勾选了"Add Python to PATH"
3. 尝试重启电脑后再运行

### Q3: 安装依赖时报错？

**解决方案**：
1. 检查网络连接
2. 尝试使用管理员权限运行
3. 如果是权限问题，可以手动执行：
   ```
   cd backend
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
   ```

### Q4: 浏览器打不开页面？

**解决方案**：
1. 确认服务已启动（命令行窗口没有报错）
2. 尝试使用 http://127.0.0.1:8000 访问
3. 检查防火墙设置

### Q5: 如何停止服务？

在运行服务的命令行窗口按 `Ctrl + C`，然后输入 `Y` 确认停止。

## 📁 目录结构

```
英语学习助手_Windows/
├── 启动服务.bat        # 启动程序
├── 安装依赖.bat        # 首次运行时安装依赖
├── README.md           # 本说明文档
├── backend/            # 后端程序
│   ├── app/            # 应用代码
│   ├── requirements.txt # Python 依赖
│   ├── .env.example    # 配置文件模板
│   └── english_helper.db # SQLite 数据库
└── frontend/           # 前端页面
    └── dist/           # 编译后的静态文件
```

## 📞 技术支持

如遇到问题，可以：
1. 查看 API 文档: http://localhost:8000/docs
2. 检查命令行窗口的错误信息

---

**版本**: 1.0.0
**更新日期**: 2024年11月
