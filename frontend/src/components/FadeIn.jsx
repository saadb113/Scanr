import { useEffect, useRef, useState } from 'react';
import './FadeIn.css';

// React port of the shared "fade in on scroll" IntersectionObserver pattern
// used across the marketing pages.
export default function FadeIn({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setVisible(true); }),
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`fade-in${visible ? ' visible' : ''} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
