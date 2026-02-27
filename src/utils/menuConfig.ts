import type { TFunction } from 'i18next';

// 菜单配置
export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  children?: MenuItem[];
  onClick?: () => void;
}

export interface MenuConfig {
  label: string;
  items: MenuItem[];
}

// 获取菜单配置（支持 i18n）
export const getMenuConfig = (t: TFunction): MenuConfig[] => [
  {
    label: t('menu.file.title'),
    items: [
      { label: t('menu.file.newConnection'), shortcut: 'Ctrl+N' },
      { label: t('menu.file.newQuery'), shortcut: 'Ctrl+Q' },
      { label: t('menu.file.open'), shortcut: 'Ctrl+O' },
      { divider: true, label: '' },
      { label: t('menu.file.save'), shortcut: 'Ctrl+S' },
      { label: t('menu.file.saveAs'), shortcut: 'Ctrl+Alt+S' },
      { divider: true, label: '' },
      { label: t('menu.file.exit'), shortcut: 'Alt+F4' },
    ],
  },
  {
    label: t('menu.edit.title'),
    items: [
      { label: t('menu.edit.undo'), shortcut: 'Ctrl+Z' },
      { label: t('menu.edit.redo'), shortcut: 'Ctrl+Y' },
      { divider: true, label: '' },
      { label: t('menu.edit.cut'), shortcut: 'Ctrl+X' },
      { label: t('menu.edit.copy'), shortcut: 'Ctrl+C' },
      { label: t('menu.edit.paste'), shortcut: 'Ctrl+V' },
      { label: t('menu.edit.selectAll'), shortcut: 'Ctrl+A' },
    ],
  },
  {
    label: t('menu.view.title'),
    items: [
      { label: t('menu.view.refresh'), shortcut: 'F5' },
      { divider: true, label: '' },
      { label: t('menu.view.erDiagram') },
      { label: t('menu.view.properties') },
      { divider: true, label: '' },
      { label: t('menu.view.toggleSidebar') },
      { label: t('menu.view.toggleStatusbar') },
    ],
  },
  {
    label: t('menu.favorites.title'),
    items: [
      { label: t('menu.favorites.add') },
      { label: t('menu.favorites.manage') },
      { divider: true, label: '' },
      { label: t('menu.favorites.sqlQueries') },
      { label: t('menu.favorites.connections') },
    ],
  },
  {
    label: t('menu.tools.title'),
    items: [
      { label: t('menu.tools.backup') },
      { label: t('menu.tools.restore') },
      { divider: true, label: '' },
      { label: t('menu.tools.importConnections') },
      { label: t('menu.tools.exportConnections') },
      { divider: true, label: '' },
      { label: t('menu.tools.options') },
    ],
  },
  {
    label: t('menu.window.title'),
    items: [
      { label: t('menu.window.maximize') },
      { label: t('menu.window.minimize') },
      { divider: true, label: '' },
      { label: t('menu.window.closeCurrentTab'), shortcut: 'Ctrl+W' },
      { label: t('menu.window.closeAllTabs') },
      { divider: true, label: '' },
      { label: t('menu.window.toggleTheme'), shortcut: 'Ctrl+Shift+L' },
    ],
  },
  {
    label: t('menu.help.title'),
    items: [
      { label: t('menu.help.mysqlDocs') },
      { label: t('menu.help.shortcuts') },
      { divider: true, label: '' },
      { label: t('menu.help.checkUpdate') },
      { divider: true, label: '' },
      { label: t('menu.help.about') },
    ],
  },
];

// 为了向后兼容，保留旧的静态配置（仅在不需要 i18n 时使用）
export const menuConfig: MenuConfig[] = [
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
      { label: '检查更新...' },
      { divider: true, label: '' },
      { label: '关于 Database Workbench' },
    ],
  },
];
