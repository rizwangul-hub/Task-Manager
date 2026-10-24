import { useState, useEffect, useCallback } from 'react';

const DISMISS_STORAGE_KEY = 'task_manager_pwa_dismissed';

export const usePwaInstall = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isSafari, setIsSafari] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // 1. Detect standalone mode (already installed or running as PWA)
    const checkStandalone = () => {
      const isDisplayStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isNavigatorStandalone = window.navigator.standalone === true; // iOS Safari standalone flag
      const standalone = Boolean(isDisplayStandalone || isNavigatorStandalone);
      setIsStandalone(standalone);
      if (standalone) {
        setIsInstalled(true);
      }
    };

    checkStandalone();

    // 2. Detect session dismissal
    const dismissed = sessionStorage.getItem(DISMISS_STORAGE_KEY) === 'true';
    setIsDismissed(dismissed);

    // 3. Detect iOS / iPadOS
    const ua = window.navigator.userAgent || '';
    const isIOSDevice =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    // Check if running in mobile Safari (not Chrome/Firefox on iOS which cannot install PWAs)
    const isWebKit = /WebKit/i.test(ua);
    const isCriOS = /CriOS/i.test(ua);
    const isFxiOS = /FxiOS/i.test(ua);
    const isSafariBrowser = isIOSDevice && isWebKit && !isCriOS && !isFxiOS;
    setIsSafari(isSafariBrowser);

    // 4. Capture native beforeinstallprompt (Android Chrome, Edge, etc.)
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    // 5. Handle appinstalled event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      sessionStorage.removeItem(DISMISS_STORAGE_KEY);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Invoke native prompt (Android / Desktop Chrome)
  const installApp = useCallback(async () => {
    if (!deferredPrompt) {
      if (isIOS) {
        setShowIosGuide(true);
        return { outcome: 'ios_guide' };
      }
      return { outcome: 'unavailable' };
    }

    try {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      return choiceResult;
    } catch (err) {
      console.warn('[PWA] Install prompt failed:', err);
      return { outcome: 'dismissed' };
    }
  }, [deferredPrompt, isIOS]);

  const dismissInstall = useCallback(() => {
    setIsDismissed(true);
    sessionStorage.setItem(DISMISS_STORAGE_KEY, 'true');
  }, []);

  return {
    isInstallable: Boolean(deferredPrompt || (isIOS && !isStandalone)),
    hasNativePrompt: Boolean(deferredPrompt),
    isStandalone,
    isInstalled,
    isDismissed,
    isIOS,
    isSafari,
    showIosGuide,
    setShowIosGuide,
    installApp,
    dismissInstall
  };
};

export default usePwaInstall;
