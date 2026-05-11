import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { supabase } from '../../../lib/supabase';
import { useEffect, useState } from 'react';

export function RedditLanding() {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user);
    });
  }, []);

  const features = [
    {
      title: 'Upvotes',
      description: 'Pesan upvote di Reddit dengan kredit',
      status: 'active',
      icon: '⬆️',
    },
    {
      title: 'Comments',
      description: 'Post komentar dengan kontrol penuh',
      status: 'coming',
      icon: '💬',
    },
    {
      title: 'New Threads',
      description: 'Buat thread baru di subreddit pilihan',
      status: 'coming',
      icon: '📌',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Hero */}
      <div className="max-w-4xl mx-auto px-4 pt-12 pb-16">
        <h1 className="text-4xl font-bold text-center text-gray-900 mb-4">
          Reddit Upvote Service
        </h1>
        <p className="text-lg text-center text-gray-600 mb-8">
          Pesan upvote berkualitas dengan sistem kredit yang fleksibel
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {features.map((f) => (
            <Card key={f.title} className="p-6">
              <div className="text-4xl mb-4">{f.icon}</div>
              <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-sm text-gray-600 mb-4">{f.description}</p>
              {f.status === 'coming' && (
                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                  Launching soon
                </span>
              )}
            </Card>
          ))}
        </div>

        <div className="text-center">
          {isLoggedIn ? (
            <Button
              onClick={() => navigate('/reddit/dashboard')}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              size="lg"
            >
              Dashboard
            </Button>
          ) : (
            <>
              <Button
                onClick={() => navigate('/login')}
                className="bg-blue-600 hover:bg-blue-700 text-white mr-2"
                size="lg"
              >
                Login
              </Button>
              <Button
                onClick={() => navigate('/register')}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900"
                size="lg"
              >
                Register
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
