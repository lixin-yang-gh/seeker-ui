import React from 'react';

const REPO_URL = 'https://github.com/lixin-yang-gh/seeker-ui';

const LINKS: Array<{ label: string; href: string; note: string }> = [
  { label: 'Source & Releases', href: `${REPO_URL}/releases`, note: 'View code and download the latest release' },
  { label: 'Report an Issue', href: `${REPO_URL}/issues`, note: 'Bugs and feature requests' },
  { label: 'Enterprise Licensing', href: `${REPO_URL}#licensing`, note: 'Bulk / commercial use inquiries' },
];

const openLink = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
  e.preventDefault();
  // Prefer the system browser via the preload bridge; fall back to window.open.
  const api = window.electronAPI as unknown as { openExternal?: (url: string) => Promise<unknown> };
  if (typeof api?.openExternal === 'function') {
    api.openExternal(href).catch((err) => console.error('Failed to open external link:', err));
  } else {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
};

const AboutTab: React.FC = () => {
  return (
    <div className="tab-panel" style={{ padding: '24px', overflowY: 'auto' }}>
      <h3 style={{ color: '#e0e0e0', margin: 0 }}>About Seeker UI</h3>
      <p style={{ color: '#888', fontSize: '13px', margin: '4px 0 20px 0' }}>
        The Visual AI Assistant
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '540px' }}>
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            onClick={(e) => openLink(e, l.href)}
            style={{ color: '#9cdcfe', fontSize: '13px', textDecoration: 'none' }}
            title={l.note}
          >
            {l.label}
            <span style={{ color: '#888', marginLeft: '8px', fontSize: '12px' }}>— {l.note}</span>
          </a>
        ))}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '24px 0 16px 0', maxWidth: '540px' }} />

      <div style={{ color: '#666', fontSize: '12px', lineHeight: 1.7 }}>
        <div>
          Repository:{' '}
          <a
            href={REPO_URL}
            onClick={(e) => openLink(e, REPO_URL)}
            style={{ color: '#9cdcfe', textDecoration: 'none' }}
          >
            github.com/lixin-yang-gh/seeker-ui
          </a>
        </div>
        <div style={{ marginTop: '4px' }}>
          Open-source software for personal, non-commercial use. Enterprise or bulk usage requires
          separate licensing — see the repository for details.
        </div>
      </div>
    </div>
  );
};

export default AboutTab;