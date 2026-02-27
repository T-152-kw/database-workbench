import type { TreeNodeType } from '../types';

// SVG图标路径映射
export const svgIcons = {
  connection: '/src/assets/connection.svg',
  mysql: '/src/assets/mysql.svg',
  design: '/src/assets/design.svg',
  play: '/src/assets/play.svg',
  refresh: '/src/assets/refresh.svg',
  theme: '/src/assets/theme.svg',
  appIcon: '/src/assets/Database Workbench.png',
} as const;

// 节点类型到图标颜色的映射（用于Lucide图标）
export const nodeTypeColors: Record<TreeNodeType, string> = {
  connection: '#28a745',      // 绿色 - 连接
  database: '#007bff',        // 蓝色 - 数据库
  tables: '#6c757d',          // 灰色 - 表文件夹
  views: '#6c757d',           // 灰色 - 视图文件夹
  functions: '#6c757d',       // 灰色 - 函数文件夹
  table: '#007bff',           // 蓝色 - 表
  view: '#17a2b8',            // 青色 - 视图
  function: '#e83e8c',        // 粉色 - 函数
  column: '#6c757d',          // 灰色 - 列
  index: '#6c757d',           // 灰色 - 索引
  foreignKey: '#17a2b8',      // 青色 - 外键
  trigger: '#ffc107',         // 黄色 - 触发器
  check: '#6610f2',           // 紫色 - 检查约束
};

// 获取节点图标颜色
export const getNodeIconColor = (nodeType: TreeNodeType): string => {
  return nodeTypeColors[nodeType] || '#6c757d';
};

// 工具栏按钮配置
export interface ToolbarButton {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  color?: string;
}

export const toolbarButtons: ToolbarButton[] = [
  { id: 'connection', label: '新建连接', icon: 'connection', color: '#4CAF50' },
  { id: 'query', label: '新建查询', icon: 'play', color: '#2196F3' },
  { id: 'table', label: '新建表', icon: 'table', color: '#007bff' },
  { id: 'view', label: '新建视图', icon: 'view', color: '#17a2b8' },
  { id: 'function', label: '新建函数', icon: 'function', color: '#e83e8c' },
  { id: 'backup', label: '备份数据库', icon: 'backup', color: '#9C27B0' },
  { id: 'restore', label: '还原数据库', icon: 'restore', color: '#E67E22' },
  { id: 'refresh', label: '刷新', icon: 'refresh', color: '#FF9800' },
  { id: 'user', label: '用户管理', icon: 'user', color: '#9C27B0' },
];

// 菜单配置
export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  children?: MenuItem[];
  onClick?: () => void;
}

export const menuConfig: { label: string; items: MenuItem[] }[] = [
  {
    label: '文件',
    items: [
      { label: '新建连接...', shortcut: 'Ctrl+N' },
      { label: '新建查询', shortcut: 'Ctrl+Q' },
      { label: '打开SQL文件...', shortcut: 'Ctrl+O' },
      { divider: true, label: '' },
      { label: '保存', shortcut: 'Ctrl+S' },
      { label: '另存为...', shortcut: 'Ctrl+Alt+S' },
      { divider: true, label: '' },
      { label: '退出', shortcut: 'Alt+F4' },
    ],
  },
  {
    label: '编辑',
    items: [
      { label: '撤销', shortcut: 'Ctrl+Z' },
      { label: '重做', shortcut: 'Ctrl+Y' },
      { divider: true, label: '' },
      { label: '剪切', shortcut: 'Ctrl+X' },
      { label: '复制', shortcut: 'Ctrl+C' },
      { label: '粘贴', shortcut: 'Ctrl+V' },
      { label: '全选', shortcut: 'Ctrl+A' },
    ],
  },
  {
    label: '查看',
    items: [
      { label: '刷新', shortcut: 'F5' },
      { divider: true, label: '' },
      { label: 'ER图表' },
      { label: '属性' },
      { divider: true, label: '' },
      { label: '显示/隐藏 导航栏' },
      { label: '显示/隐藏 状态栏' },
    ],
  },
  {
    label: '收藏夹',
    items: [
      { label: '添加到收藏夹' },
      { label: '管理收藏夹' },
      { divider: true, label: '' },
      { label: 'SQL查询' },
      { label: '连接配置' },
    ],
  },
  {
    label: '工具',
    items: [
      { label: '备份数据库...' },
      { label: '还原数据库...' },
      { divider: true, label: '' },
      { label: '导入连接配置...' },
      { label: '导出连接配置...' },
      { divider: true, label: '' },
      { label: '选项...' },
    ],
  },
  {
    label: '窗口',
    items: [
      { label: '最大化' },
      { label: '最小化' },
      { divider: true, label: '' },
      { label: '关闭当前标签', shortcut: 'Ctrl+W' },
      { label: '关闭所有标签' },
      { divider: true, label: '' },
      { label: '切换主题', shortcut: 'Ctrl+Shift+L' },
    ],
  },
  {
    label: '帮助',
    items: [
      { label: 'MySQL官方文档' },
      { label: '快捷键参考' },
      { divider: true, label: '' },
      { label: '关于 Database Workbench' },
    ],
  },
];
