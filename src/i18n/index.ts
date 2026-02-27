import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

// 从 localStorage 读取语言设置
const getStoredLanguage = () => {
  try {
    const settings = localStorage.getItem('dbw-settings');
    if (settings) {
      const parsed = JSON.parse(settings);
      // 支持两种格式：语言代码 (zh-CN/en-US) 或语言名称 (简体中文/English)
      if (parsed.language === 'zh-CN' || parsed.language === '简体中文') return 'zh-CN';
      if (parsed.language === 'en-US' || parsed.language === 'English') return 'en-US';
    }
  } catch {
    // 忽略错误
  }
  return null;
};

const storedLanguage = getStoredLanguage();

i18n
  // 使用浏览器语言检测器
  .use(LanguageDetector)
  // 使用 react-i18next
  .use(initReactI18next)
  // 初始化配置
  .init({
    // 资源文件
    resources: {
      'zh-CN': {
        translation: zhCN,
      },
      'en-US': {
        translation: enUS,
      },
    },
    // 默认语言（如果没有存储的语言）
    fallbackLng: 'zh-CN',
    // 语言检测器配置
    detection: {
      // 检测顺序：先检查我们的设置，然后是 localStorage，最后是浏览器语言
      order: ['querystring', 'localStorage', 'navigator'],
      // 缓存到 localStorage 的键名
      lookupLocalStorage: 'i18nextLng',
      // 不缓存到 cookie
      caches: ['localStorage'],
    },
    // 插值配置
    interpolation: {
      // 不转义（React 会自动处理）
      escapeValue: false,
    },
    // 调试模式（开发时开启）
    debug: false,
  });

// 如果存储了语言设置，立即切换
if (storedLanguage) {
  i18n.changeLanguage(storedLanguage);
}

export default i18n;

// 语言映射工具
export const languageMap = {
  '简体中文': 'zh-CN',
  'English': 'en-US',
} as const;

export type LanguageOption = keyof typeof languageMap;

// 切换语言函数
export const changeLanguage = (language: LanguageOption) => {
  const lng = languageMap[language];
  if (lng) {
    i18n.changeLanguage(lng);
  }
};

// 获取当前语言显示名称
export const getCurrentLanguageLabel = (): LanguageOption => {
  const currentLng = i18n.language;
  if (currentLng === 'en-US') return 'English';
  return '简体中文';
};
