import React from 'react';
import { MessageCircle, Send, Copy, Share2, Check, Camera } from 'lucide-react';
import { toast } from './Toast';

/**
 * Social-share fan-out for the referral link. The pre-filled message is
 * the same story-driven copy the WhatsApp button used (proof + Founding-100
 * scarcity + permanent-close warning) so the brand voice is consistent
 * across channels.
 *
 * The OG image (/og.png) is automatically pulled by every platform that
 * scrapes og:image from index.html — WhatsApp, Telegram, Twitter/X,
 * Facebook, LinkedIn — so the user gets a branded preview banner on every
 * channel without us shipping per-platform images.
 *
 * Native Web Share API ("Lainnya") opens the OS-level sheet on mobile,
 * letting the user pick Instagram DM, Threads, Discord, SMS, anything.
 */

const buildMessage = (link: string): string => {
  return (
    `Kamu tau nggak ada platform yang bayar kamu cuma buat komentar?\n\n` +
    `Aku baru dapat Rp50K dari komentar internet. Literally cuma komentar doang.\n\n` +
    `Platform-nya PeTa — bayar Rp5K-Rp20K per komen, cair ke e-wallet dalam 24 jam.\n\n` +
    `Sekarang lagi buka Founding 100. Artinya cuma 100 orang bisa masuk - dan udah hampir penuh.\n\n` +
    `Kalau kamu mau coba, pakai link aku biar dapet bonus Rp25K ekstra langsung:\n` +
    `${link}\n\n` +
    `PERHATIAN: kalau slot habis, tutup permanen. Aku nggak bisa janjiin kamu masih bisa masuk.`
  );
};

const shortMessage = (link: string) =>
  `Aku gabung PeTa - dibayar Rp5K-20K per komen di internet, cair 24 jam. Founding 100 - sisa slot terbatas. Pakai link aku, dapet bonus Rp25K: ${link}`;

const TWITTER_LIMIT = 280; // X / Twitter character limit (URLs count as 23)

const buildTwitter = (link: string) => {
  // Tweet must fit in 280 chars — URL counts as 23 regardless of length.
  const reserved = 23 + 4; // url + " ... "
  const headline = `Dibayar cuma buat komentar di internet. Rp5K-20K per komen, cair 24 jam ke e-wallet.`;
  const scarcity = `Founding 100 - slot terbatas. Pake link gw dapet bonus Rp25K.`;
  let body = `${headline}\n\n${scarcity}`;
  if (body.length + reserved > TWITTER_LIMIT) body = body.slice(0, TWITTER_LIMIT - reserved - 3) + '...';
  return `${body}\n\n${link}`;
};

interface SocialShareProps {
  link: string;
  /** Optional small label override; default "Share ke teman" */
  title?: string;
}

export function SocialShare({ link, title = 'Share ke teman' }: SocialShareProps) {
  const [copied, setCopied] = React.useState(false);

  const longMsg = buildMessage(link);
  const shortMsg = shortMessage(link);
  const tweetMsg = buildTwitter(link);

  const onCopy = async (text: string, label = 'Tersalin') => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-HTTPS / older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success(label);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Browser ga support copy. Tahan & copy manual.');
    }
  };

  const openWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(longMsg)}`, '_blank');
  };

  const openTelegram = () => {
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shortMsg)}`,
      '_blank',
    );
  };

  const openTwitter = () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetMsg)}`, '_blank');
  };

  const openFacebook = () => {
    // FB share dialog uses og:title/description/image scraped from the URL,
    // so we don't pass body text — quote will be ignored on most clients.
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`, '_blank');
  };

  const openNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'PeTa - Dibayar cuma buat komentar',
          text: shortMsg,
          url: link,
        });
      } catch {
        // user cancelled — silently ignore
      }
    } else {
      // Desktop fallback: copy long message
      onCopy(longMsg, 'Browser ga support native share, message tersalin');
    }
  };

  // Instagram doesn't support a URL-based share intent like WA / Telegram.
  // The compliant pattern: 1) try Web Share API with the OG image as a File
  // (mobile Safari + Android Chrome will then list Instagram in the sheet,
  // which auto-attaches the image and pre-fills the caption); 2) otherwise
  // copy the caption to clipboard, download the image, then deep-link into
  // the IG mobile app or web. User pastes caption and uploads in IG.
  const shareToInstagram = async () => {
    const caption = shortMsg;
    try {
      const res = await fetch('/og.png');
      const blob = await res.blob();
      const file = new File([blob], 'peta-share.png', { type: 'image/png' });

      // Path 1: Web Share with files (mobile)
      if (
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] }) &&
        navigator.share
      ) {
        await navigator.share({
          title: 'PeTa - Dibayar cuma buat komentar',
          text: caption,
          files: [file],
        });
        return;
      }

      // Path 2: copy caption + download image, then open Instagram.
      // Caption -> clipboard
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(caption);
        }
      } catch {/* non-fatal */}

      // Image -> auto-download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'peta-share.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      toast.success('Caption tersalin + image ke-download. Buka Instagram, upload image, paste caption.');

      // Open Instagram on mobile via deep link, fallback to web on desktop
      const ua = navigator.userAgent.toLowerCase();
      const isMobile = /android|iphone|ipad/.test(ua);
      setTimeout(() => {
        if (isMobile) {
          // instagram:// app deep link, with web fallback
          window.location.href = 'instagram://library';
          setTimeout(() => {
            // If the app didn't intercept, open instagram.com
            window.open('https://www.instagram.com/', '_blank');
          }, 1500);
        } else {
          window.open('https://www.instagram.com/', '_blank');
        }
      }, 800);
    } catch (e) {
      toast.error('Gagal siapin share Instagram. Coba copy link manual.');
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide font-bold opacity-80">{title}</p>

      {/* Primary row — WhatsApp gets the biggest button (highest conversion) */}
      <button
        onClick={openWhatsApp}
        className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:brightness-95 text-white font-extrabold rounded-xl px-3 py-3 text-sm tap-shrink shadow-md"
      >
        <MessageCircle size={18} /> WhatsApp
      </button>

      {/* Secondary row — Telegram, Instagram, X, Facebook */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          onClick={openTelegram}
          className="flex items-center justify-center gap-1.5 bg-[#0088cc] hover:brightness-95 text-white font-bold rounded-xl px-2 py-2.5 text-xs tap-shrink shadow-sm"
        >
          <Send size={14} /> Telegram
        </button>
        <button
          onClick={shareToInstagram}
          className="flex items-center justify-center gap-1.5 text-white font-bold rounded-xl px-2 py-2.5 text-xs tap-shrink shadow-sm"
          style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
        >
          <Camera size={14} /> Instagram
        </button>
        <button
          onClick={openTwitter}
          className="flex items-center justify-center gap-1.5 bg-black hover:brightness-110 text-white font-bold rounded-xl px-2 py-2.5 text-xs tap-shrink shadow-sm"
        >
          {/* X logo as inline SVG (no lucide icon for it) */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          X
        </button>
        <button
          onClick={openFacebook}
          className="flex items-center justify-center gap-1.5 bg-[#1877F2] hover:brightness-95 text-white font-bold rounded-xl px-2 py-2.5 text-xs tap-shrink shadow-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073"/></svg>
          Facebook
        </button>
      </div>

      {/* Tertiary row — Native share + copy long + copy link */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={openNativeShare}
          className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl px-2 py-2 text-xs tap-shrink ring-1 ring-white/20"
        >
          <Share2 size={13} /> Lainnya
        </button>
        <button
          onClick={() => onCopy(longMsg, 'Pesan + link tersalin')}
          className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl px-2 py-2 text-xs tap-shrink ring-1 ring-white/20"
        >
          <Copy size={13} /> Copy pesan
        </button>
        <button
          onClick={() => onCopy(link, 'Link tersalin')}
          className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl px-2 py-2 text-xs tap-shrink ring-1 ring-white/20"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} Copy link
        </button>
      </div>
    </div>
  );
}
