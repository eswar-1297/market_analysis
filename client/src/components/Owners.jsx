import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Owners({ comboId, owners }) {
  const [form, setForm] = useState({ content: '', seo: '', developer: '' });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      content: owners?.content || '',
      seo: owners?.seo || '',
      developer: owners?.developer || '',
    });
    setSaved(false);
  }, [comboId, owners]);

  const update = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    await api.saveOwners(comboId, form);
    setSaving(false);
    setSaved(true);
  };

  const fields = [
    { k: 'content', label: 'Content writer' },
    { k: 'seo', label: 'SEO owner' },
    { k: 'developer', label: 'Developer' },
  ];

  return (
    <div className="assess">
      <div className="section-title">Owners &amp; accountability</div>
      <div className="owners">
        {fields.map((f) => (
          <div className="owner-field" key={f.k}>
            <label>{f.label}</label>
            <input value={form[f.k]} onChange={update(f.k)} placeholder="name / email" />
          </div>
        ))}
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save owners'}
        </button>
        {saved && <span className="saved">✓ Saved</span>}
      </div>
    </div>
  );
}
