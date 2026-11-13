import { useEffect, useState } from 'react';
import { subscribeToasts } from '../toast';
import { AlertIcon, CheckIcon } from './Icons';

export default function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const unsubscribe = subscribeToasts((item) => {
      setItems((current) => [...current, item]);
      setTimeout(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
      }, 4200);
    });
    return unsubscribe;
  }, []);

  if (!items.length) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((item) => (
        <div className={`toast toast-${item.type}`} key={item.id}>
          <span className="toast-icon">
            {item.type === 'error' ? <AlertIcon size={18} /> : <CheckIcon size={18} />}
          </span>
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
