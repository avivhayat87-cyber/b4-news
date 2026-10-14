'use client';
// Social networks: opens only after the text is final. The social editor's distribution plan
// for the article (frame, post, story, a reel, the texts), which goes out when it is published.
import type { DraftDetail } from '@b4/shared';
import { PlanEditor } from '../social/plan-editor';
import { Button } from '../ui';

export function SocialPanel({ draft, onFinalize }: { draft: DraftDetail; onFinalize(): void }) {
  const open = draft.status === 'text_final' || draft.status === 'ready' || draft.status === 'published';
  if (!open) {
    return (
      <div className="space-y-3 p-6">
        <p className="font-display text-lg font-extrabold">הרשתות החברתיות נפתחות אחרי סיום הטקסט</p>
        <p className="text-ink-2">כשהטקסט סופי, עורך הרשתות מחליט איך הכתבה עולה לרשתות וכותב את הטקסטים, מהנוסח הסופי בלבד. כך לא מבזבזים קריאות על טיוטות.</p>
        {(draft.status === 'editing' || draft.status === 'ai_failed') && (
          <Button variant="dark" onClick={onFinalize}>
            סיום טקסט ומעבר לרשתות
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="p-5">
      <PlanEditor key={draft.id} draftId={draft.id} />
    </div>
  );
}
