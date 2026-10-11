import { Card, PageHead } from '../components/ui.jsx';
import TwoFactor from '../components/TwoFactor.jsx';
import { download } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

export default function Security() {
  const { user } = useAuth();
  const toast = useToast();
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <PageHead title="Security" sub="Protect your sign-in" />
      <TwoFactor base="/api/auth/2fa" />
      {user?.isSuper && (
        <Card title="Download a backup">
          <p className="muted">A copy of your workspace database, taken right now. Keep it somewhere safe and private. Uploaded files and documents are not inside this file.</p>
          <button className="btn" onClick={() => download('/api/settings/backup', {}, `backup-${new Date().toISOString().slice(0, 10)}.db`).catch((e) => toast(e.message, 'err'))}>Download database backup</button>
        </Card>
      )}
    </div>
  );
}
