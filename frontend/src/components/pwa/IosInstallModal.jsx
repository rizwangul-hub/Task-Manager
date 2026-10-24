import React from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Share, PlusSquare, Compass, CheckCircle2, AlertTriangle } from 'lucide-react';

export const IosInstallModal = ({ isOpen, onClose, isSafari }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Install Task Manager on iPhone"
      maxWidth="480px"
    >
      <div className="ios-install-guide">
        {/* App Preview Banner */}
        <div className="ios-install-hero">
          <img
            src="/pwa-192x192.png"
            alt="Task Manager Icon"
            className="ios-hero-icon"
          />
          <div className="ios-hero-info">
            <h3 className="ios-hero-title">Task Manager</h3>
            <p className="ios-hero-sub">Add to your Home Screen for quick 1-tap access</p>
          </div>
        </div>

        {/* Warning if not Safari */}
        {!isSafari && (
          <div className="ios-safari-warning" role="alert">
            <AlertTriangle size={18} className="safari-warning-icon" />
            <div className="safari-warning-text">
              <strong>Open in Apple Safari</strong>
              <p>
                iOS only supports home screen installation from <strong>Safari</strong>. If you are using Chrome or another browser, copy this page URL and open it in Safari.
              </p>
            </div>
          </div>
        )}

        {/* Step-by-Step Instructions */}
        <div className="ios-steps-list">
          <div className="ios-step-item">
            <div className="ios-step-number">1</div>
            <div className="ios-step-content">
              <div className="ios-step-label">
                Tap the <strong>Share</strong> button
              </div>
              <p className="ios-step-desc">
                Located in the Safari toolbar at the bottom of your screen (or top on iPad).
              </p>
              <div className="ios-step-icon-badge">
                <Share size={18} />
                <span>Share</span>
              </div>
            </div>
          </div>

          <div className="ios-step-item">
            <div className="ios-step-number">2</div>
            <div className="ios-step-content">
              <div className="ios-step-label">
                Select <strong>Add to Home Screen</strong>
              </div>
              <p className="ios-step-desc">
                Scroll down the action sheet and tap <strong>Add to Home Screen</strong>.
              </p>
              <div className="ios-step-icon-badge">
                <PlusSquare size={18} />
                <span>Add to Home Screen</span>
              </div>
            </div>
          </div>

          <div className="ios-step-item">
            <div className="ios-step-number">3</div>
            <div className="ios-step-content">
              <div className="ios-step-label">
                Confirm Name & Tap <strong>Add</strong>
              </div>
              <p className="ios-step-desc">
                Keep the name as <strong>Task Manager</strong> and tap <strong>Add</strong> in the top-right corner.
              </p>
              <div className="ios-step-icon-badge text-success">
                <CheckCircle2 size={18} />
                <span>Add</span>
              </div>
            </div>
          </div>
        </div>

        <div className="ios-install-footer">
          <Button variant="primary" size="md" onClick={onClose} className="w-full">
            Got It
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default IosInstallModal;
