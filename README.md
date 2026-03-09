# Database Workbench

一款现代化的数据库管理工具，基于 Tauri + React + TypeScript 构建，当前测试阶段暂时支持 MySQL 数据库，提供直观的用户界面，帮助开发者高效地管理数据库。

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

#### 主要依赖说明

**一键安装所有依赖：**

```bash
npm install
```

**手动安装生产依赖：**

```bash
npm install @blueprintjs/core@^6.8.0 @blueprintjs/icons@^6.5.2 @blueprintjs/select@^6.1.0 @monaco-editor/react@^4.7.0 @tanstack/react-table@^8.21.3 @tauri-apps/api@^2 @tauri-apps/plugin-dialog@^2 @tauri-apps/plugin-fs@^2 @tauri-apps/plugin-opener@^2 @tauri-apps/plugin-process@^2 @tauri-apps/plugin-shell@^2 @tauri-apps/plugin-updater@^2.10.0 @types/dagre@^0.7.53 clsx@^2.1.1 dagre@^0.8.5 date-fns@^4.1.0 docx@^9.6.0 html-to-image@^1.11.13 i18next@^25.8.13 i18next-browser-languagedetector@^8.2.1 jspdf@^4.2.0 jspdf-autotable@^5.0.7 jspdf-font@^1.0.7 lucide-react@^0.564.0 monaco-editor@^0.52.2 react@^18.3.1 react-dom@^18.3.1 react-i18next@^16.5.4 reactflow@^11.11.4 zustand@^5.0.11
```

**手动安装开发依赖：**

```bash
npm install -D @tauri-apps/cli@^2 @types/i18next@^12.1.0 @types/react@^18.3.28 @types/react-dom@^18.3.7 @vitejs/plugin-react@^4.6.0 typescript@~5.8.3 vite@^7.0.4
```

本项目使用以下核心依赖：

**UI 组件库**
- `@blueprintjs/core` / `@blueprintjs/icons` / `@blueprintjs/select` - Blueprint.js UI 组件库

**编辑器**
- `@monaco-editor/react` / `monaco-editor` - Monaco 代码编辑器

**Tauri 相关**
- `@tauri-apps/api` - Tauri 前端 API
- `@tauri-apps/plugin-dialog` / `plugin-fs` / `plugin-shell` / `plugin-updater` 等 - Tauri 官方插件

**状态管理**
- `zustand` - 轻量级状态管理

**国际化**
- `i18next` / `react-i18next` / `i18next-browser-languagedetector` - 国际化支持

**图表与可视化**
- `reactflow` - 流程图/ER 图绘制
- `dagre` - 自动布局算法

**PDF/文档导出**
- `jspdf` / `jspdf-autotable` - PDF 生成
- `docx` - Word 文档生成
- `html-to-image` - HTML 转图片

**其他工具**
- `@tanstack/react-table` - 表格组件
- `date-fns` - 日期处理
- `lucide-react` - 图标库
- `clsx` - CSS 类名处理

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

### 0.1.5

- 重构备份与还原功能，改为应用内原生实现，不再依赖 mysqldump、mysql、mysqlbinlog 等外部工具
- 新增对象级备份能力，支持按表、视图、存储过程/函数选择导出
- 新增备份高级参数，支持结构/数据分离、触发器导出、事务快照、gzip 压缩、批量 INSERT
- 新增 .sql.gz 还原支持，并支持事务执行与遇错继续
- 将备份/还原入口从标签页改为对话框，交互更轻量
- 查询结果新增服务端分页，优化大结果集场景性能与稳定性
- 优化 SQL 语句拆分逻辑，修复存储过程、函数、触发器等复合语句执行问题
- 优化 SQL 自动保存，修复保存旧内容和编辑器闪动问题
- 优化最近文件打开流程，打开文件时会同步加载实际内容
- 优化连接恢复逻辑，修复记忆数据库失效导致连接失败的问题
- 优化连接池健康检查，减少无意义探测带来的性能消耗
- 新增区域感知更新源选择，中国区优先 Gitee，其他地区优先 GitHub，并支持下载进度显示
- 增强表设计器，支持 ENUM/SET、zerofill、对象重命名及更多 ALTER SQL 生成场景
- 增强元数据树右键菜单，支持字段、索引、外键、检查约束、触发器的新增、编辑、删除、重命名
- 数据字典导出新增中英文模板切换，覆盖 HTML、Markdown、DOCX、PDF

### v0.1.2

- 重写执行结果框，采用类 Navicat 的执行结果布局方式，可更直观地展示当前语句执行情况
- 为左侧元数据树标签新增丰富的右键事件处理逻辑
- 为左侧元数据树标签新增双击事件处理逻辑
- 修复新建/编辑函数的模板异常问题
- 修复注释填写无响应的交互问题
- 修复名称填写无响应的交互问题

### v0.1.1

- 修复表格日期类型字段默认显示毫秒（后缀6个0）的问题，优化为仅在毫秒值非0时展示毫秒部分
- 新增数据字典功能，目前文案为英文版

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