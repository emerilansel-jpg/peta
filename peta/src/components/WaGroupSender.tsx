// Reusable "send to WA group" action block used inside the post-approve and
// post-payout WA modals. Three layers, most-automated first:
//   1. Auto-send via Fonnte — only when a group JID (…@g.us) is configured.
//   2. One-time group picker — lists groups the Fonnte bot has seen (inbound
//      webhook), or accept a pasted JID. Saves to app_secrets.PETA_WA_GROUP_JID.
//   3. Manual fallback — copy the message + open the group invite link. Always
//      available, so the admin is never blocked even if Fonnte/group isn't set.
import { useState, useEffect } from 'react';
import { Copy, Users, Send, Settings2 } from 'lucide-react';
import { WHATSAPP_GROUP_URL } from '../lib/config';
import {
  getWaGroupJid,
  listDiscoveredWaGroups,
  setWaGroupJid,
  sendWaGroup,
  type DiscoveredWaGroup,
} from '../lib/api';
import { toast } from './Toast';

export function WaGroupSender({ message }: { message: string }) {
  const [jid, setJid] = useState<string | null>(null);
  const [loadingJid, setLoadingJid] = useState(true);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [groups, setGroups] = useState<DiscoveredWaGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [pasteJid, setPasteJid] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getWaGroupJid().then((v) => {
      setJid(v);
      setLoadingJid(false);
    });
  }, []);

  const openPicker = async () => {
    setShowPicker(true);
    setLoadingGroups(true);
    const g = await listDiscoveredWaGroups();
    setGroups(g);
    setLoadingGroups(false);
  };

  const saveJid = async (value: string) => {
    const v = value.trim();
    if (!/@g\.us$/.test(v)) {
      toast.error('JID grup harus diakhiri @g.us');
      return;
    }
    setSaving(true);
    try {
      await setWaGroupJid(v);
      setJid(v);
      setShowPicker(false);
      setPasteJid('');
      toast.success('Grup WA tersimpan ✅');
    } catch (e: any) {
      toast.error(`Gagal simpan: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const sendViaFonnte = async () => {
    if (!jid) return;
    setSending(true);
    try {
      const res = await sendWaGroup(jid, message);
      if (res.sent) toast.success('Terkirim ke grup WA via Fonnte ✅');
      else toast.error(`Fonnte gagal: ${res.error || 'unknown'} — coba kirim manual di bawah`);
    } catch (e: any) {
      toast.error(`Error: ${e.message || e}`);
    } finally {
      setSending(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div className="space-y-2">
      {/* 1. Auto-send via Fonnte — only when a group JID is configured */}
      {jid && (
        <>
          <button
            onClick={sendViaFonnte}
            disabled={sending}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#25D366] hover:brightness-110 disabled:opacity-60 text-white font-extrabold text-sm transition tap-shrink"
          >
            {sending ? (
              <><span className="animate-spin">⏳</span> Mengirim...</>
            ) : (
              <><Send size={15} /> Kirim Otomatis ke Grup via Fonnte</>
            )}
          </button>
          <div className="flex items-center justify-between text-[10px] text-muted px-1">
            <span className="font-mono truncate">Grup: {jid}</span>
            <button onClick={openPicker} className="shrink-0 text-primary font-semibold hover:underline ml-2">
              ganti
            </button>
          </div>
          <div className="flex items-center gap-2 py-0.5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] text-muted">atau manual</span>
            <div className="flex-1 h-px bg-border" />
          </div>
        </>
      )}

      {/* 2a. No JID configured → prompt to set up auto-send */}
      {!loadingJid && !jid && (
        <button
          onClick={openPicker}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl ring-1 ring-[#25D366]/40 text-[#25D366] hover:bg-[#25D366]/5 font-bold text-xs transition"
        >
          <Settings2 size={14} /> Set grup untuk kirim otomatis via Fonnte
        </button>
      )}

      {/* 3. Manual fallback — always available */}
      <button
        onClick={copy}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-dark hover:brightness-110 text-white font-extrabold text-sm transition tap-shrink"
      >
        <Copy size={15} /> {copied ? 'Tersalin ✅' : 'Copy Pesan'}
      </button>
      <a
        href={WHATSAPP_GROUP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl bg-[#25D366] hover:brightness-105 text-white font-extrabold text-sm transition tap-shrink"
      >
        <Users size={15} /> Buka Grup WA → Paste & Kirim
      </a>

      {/* 2b. Group picker — discovered groups + paste fallback */}
      {showPicker && (
        <div className="mt-2 p-3 rounded-xl bg-light ring-1 ring-border space-y-2">
          <p className="text-[11px] font-bold text-dark">
            Pilih grup PeTa <span className="font-normal text-muted">(nomor Fonnte harus jadi member grup)</span>:
          </p>
          {loadingGroups ? (
            <p className="text-[11px] text-muted">Memuat grup...</p>
          ) : groups.length === 0 ? (
            <p className="text-[11px] text-muted leading-snug">
              Belum ada grup kedeteksi. Pastikan nomor Fonnte udah join grup PeTa, terus suruh
              seseorang kirim 1 pesan di grup — nanti otomatis muncul di sini. Atau paste JID grup manual di bawah.
            </p>
          ) : (
            <div className="space-y-1">
              {groups.map((g) => (
                <button
                  key={g.jid}
                  onClick={() => saveJid(g.jid)}
                  disabled={saving}
                  className="w-full text-left p-2 rounded-lg bg-white ring-1 ring-border hover:ring-[#25D366] transition text-[11px] disabled:opacity-60"
                >
                  <p className="font-mono font-bold truncate">{g.jid}</p>
                  <p className="text-muted truncate">"{g.sample}" · {g.msgs} pesan</p>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              value={pasteJid}
              onChange={(e) => setPasteJid(e.target.value)}
              placeholder="atau paste JID: 1234...@g.us"
              className="flex-1 px-2 py-1.5 text-[11px] font-mono bg-white rounded-lg ring-1 ring-border focus:outline-none focus:ring-[#25D366]"
            />
            <button
              onClick={() => saveJid(pasteJid)}
              disabled={saving || !pasteJid.trim()}
              className="px-3 py-1.5 rounded-lg bg-[#25D366] text-white font-bold text-[11px] disabled:opacity-50"
            >
              Simpan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
