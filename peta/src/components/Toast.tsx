import { Toaster, toast } from 'react-hot-toast';

export function ToastProvider() {
  return (
    <Toaster
      position="top-center"
      reverseOrder={false}
      gutter={8}
      toastOptions={{
        duration: 4000,
        style: {
          background: '#333',
          color: '#fff',
          borderRadius: '8px',
          padding: '16px',
        },
        success: {
          style: {
            background: '#4ECDC4',
          },
        },
        error: {
          style: {
            background: '#FF6B6B',
          },
        },
      }}
    />
  );
}

export { toast };
