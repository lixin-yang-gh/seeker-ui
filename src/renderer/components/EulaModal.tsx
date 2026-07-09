// src/renderer/components/EulaModal.tsx
// ────────────────────────────────────────────────
// End-User License Agreement modal – blocks the UI
// until the user agrees or denies/exit.
// Agreement is persisted via electron-store.
// ────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';

interface EulaModalProps {
  /** Called once the user agrees; hides the modal */
  onAgreed: () => void;
}

const EulaContent: React.FC = () => (
  <div style={{ fontSize: '13px', lineHeight: 1.7, color: '#d4d4d4' }}>
    <h2 style={{ color: '#ccc', marginBottom: '12px' }}>Seeker UI - The Visual AI Workspace</h2>

    <h2 style={{ color: '#ccc', marginBottom: '12px' }}>End-User License Agreement & Disclaimer</h2>

    <p style={{ marginBottom: '12px' }}>
      <strong>1. Acceptance of Terms</strong><br />
      By clicking "Agree and Proceed", you accept the terms of this agreement. If you do not agree, click "Deny and Exit" to quit the application.
    </p>

    <p style={{ marginBottom: '12px' }}>
      <strong>2. Disclaimer of Liability</strong><br />
      This software is provided "as is" and "as available", without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement. To the maximum extent permitted by applicable law, the authors and contributors shall not be liable for any direct, indirect, incidental, special, consequential, or exemplary damages arising from the use of, or inability to use, this software.
    </p>

    <p style={{ marginBottom: '12px' }}>
      <strong>3. OpenRouter API &amp; Model Output</strong><br />
      This application acts solely as a client that forwards your prompts and selected file content to third-party inference providers via the OpenRouter API, using credentials you supply. The authors do not operate, control, or endorse OpenRouter or any underlying model provider. AI-generated responses may be inaccurate, incomplete, biased, or otherwise unsuitable, and responsibility for reviewing and using any output rests entirely with you. To the maximum extent permitted by applicable law, you waive and agree not to assert against the authors any claim, and the authors disclaim all liability, for any loss, damage, data corruption, cost, billing, service interruption, availability, or content arising from the OpenRouter API, its responses, provider behavior, or any third-party model. Your use of OpenRouter is additionally governed by OpenRouter's own terms and privacy policy.
    </p>

    <p style={{ marginBottom: '12px' }}>
      <strong>4. Use at Your Own Risk</strong><br />
      The user assumes full responsibility for any changes made to files or data through this application, including changes applied from AI-generated output. Always maintain current backups before applying file updates.
    </p>

    <p style={{ marginBottom: '12px' }}>
      <strong>5. Security &amp; Privacy — Local-First by Design</strong><br />
      All application settings, prompts, and per-folder state are stored locally on your device. The application itself collects, stores, and transmits no personal data, telemetry, analytics, or usage statistics, and contains no advertising or tracking. Your API key is stored locally and is sent only to the OpenRouter API to authenticate your own requests. The only data that leaves your device is the prompt and file content you explicitly choose to send for inference, sent directly to the third-party provider you configure. Optional built-in redaction and masking features help you avoid transmitting sensitive information, but you remain responsible for reviewing what you send.
    </p>

    <p style={{ marginBottom: '12px' }}>
      <strong>6. Open Source, Licensing &amp; Personal Use</strong><br />
      This application is open-source software intended solely for personal, non-commercial use. From a copyright and licensing perspective, enterprise, organizational, commercial, or bulk usage is not covered by this agreement and requires separate licensing negotiated with the copyright holder — please contact the authors to arrange enterprise terms. Use of the source code itself remains subject to the license distributed with the project.
    </p>

    <p style={{ marginBottom: '12px' }}>
      <strong>7. Governing Law</strong><br />
      This agreement shall be governed by the laws of the jurisdiction of the developer.
    </p>

    <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '16px 0' }} />
  </div>
);

const EulaModal: React.FC<EulaModalProps> = ({ onAgreed }) => {
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const checkAgreement = async () => {
      try {
        const agreed = await window.electronAPI.getEulaAgreed();
        if (agreed) {
          onAgreed();
          setShowModal(false);
        } else {
          setShowModal(true);
        }
      } catch (err) {
        console.error('Failed to check EULA agreement:', err);
        // If we can't check, show the modal by default
        setShowModal(true);
      } finally {
        setLoading(false);
      }
    };
    checkAgreement();
  }, [onAgreed]);

  const handleAgree = async () => {
    try {
      await window.electronAPI.setEulaAgreed(true);
      onAgreed();
      setShowModal(false);
    } catch (err) {
      console.error('Failed to save EULA agreement:', err);
    }
  };

  const handleDeny = () => {
    window.electronAPI.quitApp().catch((err: unknown) => {
      console.error('Failed to quit app:', err);
      window.close();
    });
  };

  if (loading) {
    return (
      <div style={overlayBaseStyle}>
        <div style={{ color: '#aaa', fontSize: '14px' }}>Loading...</div>
      </div>
    );
  }

  if (!showModal) return null;

  return (
    <div style={overlayBaseStyle}>
      <div style={modalBoxStyle}>
        <div style={scrollContentStyle}>
          <EulaContent />
        </div>
        <div style={buttonRowStyle}>
          <button
            style={agreeButtonStyle}
            onClick={handleAgree}
            title="Accept the EULA and continue"
          >
            Agree and Proceed
          </button>
          <button
            style={denyButtonStyle}
            onClick={handleDeny}
            title="Decline and quit the application"
          >
            Deny and Exit
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────

const overlayBaseStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.75)',
  zIndex: 99999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalBoxStyle: React.CSSProperties = {
  background: '#1e1e1e',
  border: '1px solid #555',
  borderRadius: '10px',
  padding: '24px 28px',
  maxWidth: '640px',
  width: '90%',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 10px 40px rgba(0,0,0,0.7)',
};

const scrollContentStyle: React.CSSProperties = {
  overflowY: 'auto',
  flex: '1 1 auto',
  paddingRight: '6px',
  marginBottom: '16px',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  flexShrink: 0,
  paddingTop: '12px',
  borderTop: '1px solid #333',
};

const agreeButtonStyle: React.CSSProperties = {
  padding: '10px 24px',
  background: '#0e639c',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.2s',
};

const denyButtonStyle: React.CSSProperties = {
  padding: '10px 24px',
  background: '#5a1e1e',
  color: '#ff8a80',
  border: '1px solid #8b3a3a',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.2s',
};

export default EulaModal;