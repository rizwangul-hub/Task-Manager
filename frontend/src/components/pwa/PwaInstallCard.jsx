import React, { useState } from 'react';
import Button from '../ui/Button';
import IosInstallModal from './IosInstallModal';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { Download, Smartphone, Check, X, Apple } from 'lucide-react';

export const PwaInstallCard = () => {
  const {
    isInstallable,
    hasNativePrompt,
    isStandalone,
    isInstalled,
    isDismissed,
    isIOS,
    isSafari,
    showIosGuide,
    setShowIosGuide,
    installApp,
    dismissInstall
  } = usePwaInstall();

  const [installing, setInstalling] = useState(false);
  const [showAndroidInstructions, setShowAndroidInstructions] = useState(false);

  // If running in standalone mode (already installed), do not show installation prompt
  if (isStandalone) {
    return null;
  }

  // If dismissed during this session, do not show
  if (isDismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIosGuide(true);
      return;
    }

    if (hasNativePrompt) {
      setInstalling(true);
      try {
        await installApp();
      } finally {
        setInstalling(false);
      }
    } else {
      // Browser didn't expose native beforeinstallprompt (e.g. desktop Chrome menu or other browsers)
      setShowAndroidInstructions(true);
    }
  };

  return (
    <>
      <div className="pwa-install-card" role="region" aria-label="Install App">
        <button
          type="button"
          className="pwa-dismiss-btn"
          onClick={dismissInstall}
          aria-label="Dismiss install banner"
          title="Dismiss"
        >
          <X size={16} />
        </button>

        <div className="pwa-install-body">
          <div className="pwa-logo-wrapper">
            <img
              src="/pwa-192x192.png"
              alt="Task Manager App Icon"
              className="pwa-card-logo"
            />
          </div>

          <div className="pwa-content-wrapper">
            <div className="pwa-title-row">
              <h4 className="pwa-app-title">Task Manager</h4>
              <span className="pwa-badge">Web App</span>
            </div>
            <p className="pwa-app-description">
              Install Task Manager on your phone for quick access.
            </p>

            <div className="pwa-action-row">
              {isInstalled ? (
                <div className="pwa-installed-pill">
                  <Check size={14} className="text-success" />
                  <span>App Installed</span>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={isIOS ? Apple : Download}
                  isLoading={installing}
                  onClick={handleInstallClick}
                  className="pwa-install-button"
                >
                  {isIOS ? 'Add to Home Screen' : 'Install App'}
                </Button>
              )}
            </div>

            {showAndroidInstructions && !hasNativePrompt && !isIOS && (
              <div className="pwa-manual-instructions">
                <p>
                  To install, tap your browser's menu (<strong>⋮</strong> or <strong>Share</strong>) and choose <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* iOS Safari Installation Guide Modal */}
      <IosInstallModal
        isOpen={showIosGuide}
        onClose={() => setShowIosGuide(false)}
        isSafari={isSafari}
      />
    </>
  );
};

export default PwaInstallCard;
