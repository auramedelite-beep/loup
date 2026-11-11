import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar';

export function applyDocumentLanguage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';
}

export function currentLanguage(): 'ar' {
  return 'ar';
}

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
  },
  lng: 'ar',
  fallbackLng: 'ar',
  supportedLngs: ['ar'],
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDocumentLanguage();

export default i18n;
