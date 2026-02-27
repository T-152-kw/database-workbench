# Database Workbench

一款现代化的数据库管理工具，基于 Tauri + React + TypeScript 构建，当前测试阶段仅仅支持 MySQL 数据库，提供直观的用户界面，帮助开发者高效地管理数据库。

## 功能特性

### 核心功能

- **连接管理** - 目前预览测试阶段暂时支持MySQL数据库连接，SSL 安全连接，连接配置导入/导出
- **SQL 编辑器** - 基于 Monaco Editor，支持语法高亮、自动补全、格式化、多结果集
- **表数据管理** - 数据浏览、编辑、新增、删除，支持分页和 CSV 导出
- **表设计器** - 可视化设计表结构，支持字段、索引、外键、检查约束、触发器
- **视图设计器** - 创建和编辑视图，支持视图数据编辑（可更新视图）
- **函数/存储过程** - 创建、编辑、执行函数和存储过程
- **用户管理** - 用户创建、权限管理、服务器权限和数据库权限配置
- **数据库备份** - 支持 mysqldump 备份，增量备份（binlog），定时备份调度
- **数据库恢复** - 支持 mysql 恢复，可恢复到现有或新建数据库
- **ER 图生成** - 自动生成数据库 ER 关系图，支持导出为 PNG/JPG/PDF

### 其他特性

- **收藏夹** - 收藏 SQL 查询、连接配置、数据库对象
- **自动更新** - 支持应用自动检查更新，一键下载安装
- **多语言** - 支持简体中文、English
- **主题切换** - 支持浅色/深色主题
- **快捷键** - 丰富的键盘快捷键支持

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Tauri v2 |
| 前端 | React 18 + TypeScript |
| UI 组件 | Blueprint.js |
| 编辑器 | Monaco Editor |
| 状态管理 | Zustand |
| 国际化 | i18next |
| 图表 | React Flow |
| 后端 | Rust |
| 数据库 | MySQL |

## 系统要求

- Windows 10/11 (x64)
- MySQL 5.7+ 或 MySQL 8.0+

## 安装

### 从 Release 下载

前往 [Releases](https://github.com/T-152-kw/database-workbench/releases) 页面下载最新版本的安装包。

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/T-152-kw/database-workbench.git
cd database-workbench

# 安装依赖
npm install

# 开发模式运行
npm run tauri dev

# 构建生产版本
npm run tauri build
```

## 项目结构

```
database-workbench/
├── src/                    # 前端源码
│   ├── components/         # React 组件
│   │   ├── dialogs/        # 对话框组件
│   │   ├── layout/         # 布局组件
│   │   ├── query/          # 查询编辑器组件
│   │   ├── tabs/           # 标签页组件
│   │   └── tree/           # 元数据树组件
│   ├── hooks/              # 自定义 Hooks
│   ├── i18n/               # 国际化配置
│   ├── services/           # 服务层
│   ├── stores/             # 状态管理
│   ├── styles/             # 样式文件
│   ├── types/              # TypeScript 类型定义
│   └── utils/              # 工具函数
├── src-tauri/              # Tauri 后端源码
│   ├── src/
│   │   ├── backend/        # 后端业务逻辑
│   │   └── main.rs         # 入口文件
│   ├── icons/              # 应用图标
│   └── capabilities/       # 权限配置
├── public/                 # 静态资源
└── package.json            # 前端依赖配置
```

## 开发指南

### 环境准备

1. 安装 [Node.js](https://nodejs.org/) (v18+)
2. 安装 [Rust](https://www.rust-lang.org/tools/install)
3. 安装 [VS Code](https://code.visualstudio.com/)
4. 安装推荐扩展：
   - [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
   - [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### 常用命令

```bash
# 开发模式
npm run tauri dev

# 构建前端
npm run build

# 构建完整应用
npm run tauri build

# 类型检查
npx tsc --noEmit
```

## 配置说明

### 连接配置

应用支持以下 MySQL 连接参数：

- 主机地址
- 端口号
- 用户名/密码
- 默认数据库
- 字符集
- SSL 模式（Disabled/Preferred/Required/Verify CA/Verify Identity）
- SSL 证书配置

### 应用设置

在"工具" → "选项"中可配置：

- 语言设置
- 主题设置
- 启动选项
- 编辑器设置（字体大小、Tab 大小、自动换行等）
- 界面设置（侧边栏、状态栏）

## 更新日志

### v0.1.0

- 完成大部分基本功能
- 优化自动更新检查功能
- 添加新版本黄点提示
- 修复测试阶段出现的若干问题

## 许可证

[MIT License](LICENSE)

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

如有问题或建议，请在 GitHub 或 Gitee 上提交 Issue。

Github地址: [T-152-kw/database-workbench](https://github.com/T-152-kw/database-workbench)

Gitee地址: [T-152-kw/database-workbench](https://gitee.com/nick4487617348/database-workbench)
