import type { Metadata } from 'next';
import { wrap } from '@/components/ui';
import { MyFeed } from './my-feed';

export const metadata: Metadata = { title: 'הפיד שלי', robots: { index: false } };

/** "הפיד שלי": articles in the reader's topics with the conversation around them. */
export default function MyFeedPage() {
  return (
    <div className={`${wrap} py-10`}>
      <div className="mx-auto max-w-[760px]">
        <h1 className="mb-1 text-[34px] font-extrabold leading-tight md:text-[42px]">הפיד שלי</h1>
        <MyFeed />
      </div>
    </div>
  );
}
