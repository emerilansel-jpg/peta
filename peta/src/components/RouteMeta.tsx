import React from 'react';
import { useLocation } from 'react-router-dom';

const STRAIGHT_HOST_RE = /(^|\.)straight\.ltd$/i;

interface RouteMetaConfig {
  title: string;
  description: string;
  canonical: string;
  robots: string;
}

export function RouteMeta() {
  const location = useLocation();

  React.useEffect(() => {
    // Skip PeTa route title overriding if hostname is Straight Ltd
    if (typeof window !== 'undefined' && STRAIGHT_HOST_RE.test(window.location.hostname)) {
      return;
    }

    const path = location.pathname;
    let meta: RouteMetaConfig;

    if (path === '/') {
      meta = {
        title: 'Penghasilan Tambahan Online — Dibayar Cuma Buat Komentar | PeTa',
        description: 'Penghasilan tambahan online tanpa skill — PeTa bayar Rp5K–Rp20K tiap komentar di internet, tarik saldo kapan saja tanpa minimum payout.',
        canonical: 'https://penghasilantambahan.com/',
        robots: 'index, follow',
      };
    } else if (path === '/register') {
      meta = {
        title: 'Daftar PeTa Army Gratis — Penghasilan Tambahan Online',
        description: 'Daftar gratis dalam 30 detik tanpa deposit. Kerjakan task digital dari HP dan dapatkan bonus referral Rp20.000.',
        canonical: 'https://penghasilantambahan.com/register',
        robots: 'index, follow',
      };
    } else if (path === '/login') {
      meta = {
        title: 'Login PeTa Army — Masuk ke Dashboard Kamu',
        description: 'Masuk ke akun PeTa Army untuk melihat task yang tersedia dan menarik saldo hasil tugasmu.',
        canonical: 'https://penghasilantambahan.com/login',
        robots: 'index, follow',
      };
    } else if (path === '/help') {
      meta = {
        title: 'Pusat Bantuan & FAQ — PenghasilanTambahan.com (PeTa)',
        description: 'Jawaban lengkap seputar cara kerja PeTa, kriteria approval task, penarikan saldo tanpa minimum, dan bantuan teknis.',
        canonical: 'https://penghasilantambahan.com/help',
        robots: 'index, follow',
      };
    } else if (path === '/terms') {
      meta = {
        title: 'Syarat & Ketentuan — PeTa (PenghasilanTambahan.com)',
        description: 'Syarat dan ketentuan resmi pengerjaan task, reward, dan penarikan saldo komunitas PeTa Army.',
        canonical: 'https://penghasilantambahan.com/terms',
        robots: 'index, follow',
      };
    } else if (path === '/privacy') {
      meta = {
        title: 'Kebijakan Privasi — PeTa (PenghasilanTambahan.com)',
        description: 'Kebijakan privasi dan perlindungan data pengguna komunitas PeTa Army.',
        canonical: 'https://penghasilantambahan.com/privacy',
        robots: 'index, follow',
      };
    } else {
      // Member/admin/private routes
      meta = {
        title: 'PeTa — PenghasilanTambahan.com',
        description: 'Platform microtask dan penghasilan tambahan online Indonesia.',
        canonical: `https://penghasilantambahan.com${path}`,
        robots: 'noindex, nofollow',
      };
    }

    document.title = meta.title;

    let descEl = document.querySelector('meta[name="description"]');
    if (!descEl) {
      descEl = document.createElement('meta');
      descEl.setAttribute('name', 'description');
      document.head.appendChild(descEl);
    }
    descEl.setAttribute('content', meta.description);

    let canEl = document.querySelector('link[rel="canonical"]');
    if (!canEl) {
      canEl = document.createElement('link');
      canEl.setAttribute('rel', 'canonical');
      document.head.appendChild(canEl);
    }
    canEl.setAttribute('href', meta.canonical);

    let robEl = document.querySelector('meta[name="robots"]');
    if (!robEl) {
      robEl = document.createElement('meta');
      robEl.setAttribute('name', 'robots');
      document.head.appendChild(robEl);
    }
    robEl.setAttribute('content', meta.robots);
  }, [location.pathname]);

  return null;
}
