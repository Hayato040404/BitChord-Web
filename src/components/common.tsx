/**
 * BitChord web — shared UI pieces.
 *
 * Ported from the app's components package (Common.kt, skeletons): shelf
 * carousels, the hero card, sign-in banner, feed skeletons and message states.
 */

import type { HomeShelf, ShelfItem } from '../api/models';
import type { BrowseType } from '../api/models';
import { SmartArt } from './SmartArt';

export const PAGE_GUTTER = 20;

interface CardProps {
  item: ShelfItem;
  onClick: () => void;
  onLongPress?: () => void;
}

export function ShelfCard({ item, onClick, onLongPress }: CardProps) {
  let timer: number | null = null;

  const start = () => {
    if (!onLongPress) return;
    timer = window.setTimeout(() => onLongPress(), 550);
  };
  const clear = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const isCollection = item.browseId != null;

  return (
    <button
      className="shelf-card"
      onClick={onClick}
      onTouchStart={start}
      onTouchEnd={clear}
      onTouchMove={clear}
      onContextMenu={
        onLongPress
          ? (e) => {
              e.preventDefault();
              onLongPress();
            }
          : undefined
      }
    >
      <div className="shelf-card-art">
        <SmartArt
          src={item.thumbnailUrl}
          videoId={item.videoId}
          size={160}
          radius={12}
          className="shelf-card-img"
        />
      </div>
      <span className="shelf-card-title body-medium" style={{ fontWeight: 500 }}>
        {item.title}
      </span>
      <span className="shelf-card-subtitle label-small" style={{ color: 'var(--on-surface-variant)' }}>
        {item.subtitle}
      </span>
      {isCollection ? null : null}
    </button>
  );
}

export function ShelfCarousel({
  shelf,
  onItemClick,
  onItemLongPress,
}: {
  shelf: HomeShelf;
  onItemClick: (item: ShelfItem) => void;
  onItemLongPress?: (item: ShelfItem) => void;
}) {
  return (
    <section className="shelf">
      <div className="shelf-header page-gutter">
        <h2 className="shelf-title title-medium">{shelf.title}</h2>
      </div>
      <div className="shelf-scroller">
        {shelf.items.map((item, i) => (
          <ShelfCard
            key={`${item.videoId ?? item.browseId ?? i}-${i}`}
            item={item}
            onClick={() => onItemClick(item)}
            onLongPress={onItemLongPress ? () => onItemLongPress(item) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

export function HeroCard({
  title,
  subtitle,
  thumbnailUrl,
  videoId,
  onClick,
}: {
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  videoId: string | null;
  onClick: () => void;
}) {
  return (
    <button className="hero-card page-gutter" onClick={onClick}>
      <div className="hero-card-art">
        <SmartArt
          src={thumbnailUrl}
          videoId={videoId}
          size={640}
          radius={16}
          eager
          keepOriginalSize
          className="hero-card-img"
        />
      </div>
      <div className="hero-card-overlay">
        <div>
          <span className="hero-card-label label-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {subtitle}
          </span>
          <span className="hero-card-title headline-medium" style={{ color: '#fff' }}>
            {title}
          </span>
        </div>
        {videoId ? (
          <span className="hero-play" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v14.72q0 .575.5.8t.9-.06l10.6-7.36q.4-.275.4-.74t-.4-.74L9.4 4.4q-.4-.285-.9-.06T8 5.14Z" transform="translate(1 0)" />
            </svg>
          </span>
        ) : null}
      </div>
    </button>
  );
}

export function SignInBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="sign-in-banner page-gutter">
      <div className="body-medium">
        <b style={{ fontWeight: 600 }}>Listening as a guest</b>
        <div style={{ color: 'var(--on-surface-variant)' }}>
          Sign-in is not available in the web port — your likes, playlists and history are saved on this
          device instead.
        </div>
      </div>
    </div>
  );
}

export function FeedSkeleton({ firstIsHero = true }: { firstIsHero?: boolean }) {
  return (
    <div>
      {firstIsHero && (
        <div className="page-gutter" style={{ marginBottom: 16 }}>
          <div className="skeleton" style={{ height: 180, borderRadius: 16 }} />
        </div>
      )}
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ marginBottom: 20 }}>
          <div className="skeleton page-gutter" style={{ height: 22, width: '45%', marginBottom: 12, borderRadius: 6 }} />
          <div className="shelf-scroller">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} style={{ width: 140 }}>
                <div className="skeleton" style={{ width: 140, height: 140, borderRadius: 12 }} />
                <div className="skeleton" style={{ height: 12, width: '90%', marginTop: 8 }} />
                <div className="skeleton" style={{ height: 10, width: '60%', marginTop: 6 }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="message-state">
      <div className="title-large">{title}</div>
      <div className="body-medium" style={{ color: 'var(--on-surface-variant)', marginTop: 6, maxWidth: 320 }}>
        {message}
      </div>
      {onRetry && (
        <button className="retry-button label-medium" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function SectionTitle({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="page-gutter" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
      <h2 className="title-large">{children}</h2>
      {trailing}
    </div>
  );
}

export type { BrowseType };
