/**
 * Tiny i18n layer: EN / JA string tables + a module-level `t()`.
 *
 * Components read `settings.language` through the app store, so switching
 * language re-renders App and every screen picks the new table without
 * per-component subscriptions. Parameter interpolation uses `{name}` slots.
 */

export type Language = 'en' | 'ja';

type Dict = Record<string, string>;

const en: Dict = {
  'tab.home': 'Home',
  'tab.explore': 'Explore',
  'tab.library': 'Library',
  'tab.search': 'Search',

  'msg.tryAgain': 'Try again',
  'msg.somethingWrong': 'Something went wrong',
  'msg.nothingHere': 'Nothing here',

  'common.guestTitle': 'Listening as a guest',
  'common.guestBody': 'Sign-in is not available in the web port — your likes, playlists and history are saved on this device instead.',
  'common.playlist': 'playlist',

  'home.recents': 'Recents',
  'home.error': 'Could not load the feed',

  'explore.title': 'Explore',
  'explore.error': 'Could not load Explore',
  'explore.moodError': 'Could not load this mood',
  'explore.moodEmpty': 'This mood has no shelves right now.',

  'library.title': 'Library',
  'library.playlists': 'Playlists',
  'library.newPlaylist': 'New playlist',
  'library.playlistTitle': 'Playlist title',
  'library.create': 'Create',
  'library.noPlaylists': 'No playlists yet.',
  'library.deletedToast': 'Deleted {title}',
  'library.likedSongs': 'Liked songs',
  'library.playAll': 'Play all',
  'library.likedEmpty': 'Tracks you like land here. They are saved on this device.',
  'library.showAllSongs': 'Show all {n} songs',
  'library.history': 'History',
  'library.playsEmpty': 'Plays are recorded here as you listen.',
  'library.showAllPlays': 'Show all {n} plays',
  'library.showLess': 'Show less',

  'playlist.oneSong': '1 song',
  'playlist.songs': '{n} songs',
  'playlist.play': 'Play',
  'playlist.shuffle': 'Shuffle',
  'playlist.removedToast': 'Removed from playlist',
  'playlist.empty': "Empty playlist — add songs from any row's menu.",

  'search.placeholder': 'Songs, artists, albums…',
  'search.failed': 'Search failed',
  'filter.all': 'All',
  'filter.songs': 'Songs',
  'filter.videos': 'Videos',
  'filter.albums': 'Albums',
  'filter.artists': 'Artists',
  'filter.playlists': 'Playlists',
  'type.album': 'Album',
  'type.artist': 'Artist',
  'type.playlist': 'Playlist',

  'detail.loadError': 'Could not load this page',
  'detail.empty': 'No tracks parsed from this page.',

  'player.retry': 'Retry',
  'player.playbackSpeed': 'Playback speed',
  'player.sleepTimer': 'Sleep timer',
  'player.volume': 'Volume',
  'player.queue': 'Queue',
  'player.lyricsTitle': 'Lyrics',

  'queue.title': 'Queue',
  'queue.clear': 'Clear',
  'queue.clearedToast': 'Cleared upcoming songs',
  'queue.nowPlaying': 'Now playing',
  'queue.nextUp': 'Next up · {n}',
  'queue.emptyLoop': 'Nothing else lined up — the queue loops from the top when this track ends.',
  'queue.emptyRepeat': 'Nothing else lined up — this track repeats when it ends.',
  'queue.emptyAutoplay': 'Nothing else lined up — AutoPlay will keep the music going when this ends.',
  'queue.emptyAdd': 'Nothing else lined up — add more songs from the ⋯ menu anywhere.',
  'queue.moveUp': 'Move up',
  'queue.moveDown': 'Move down',

  'sleep.title': 'Sleep timer',
  'sleep.stoppingIn': 'Stopping in {time}',
  'sleep.min': '{m} min',
  'sleep.cancel': 'Cancel timer',

  'lyrics.providerFallback': 'Lyrics',
  'lyrics.searching': 'Searching…',
  'lyrics.noLyrics': 'No lyrics found',
  'lyrics.titleFixBody': "The title on YouTube is sometimes not the title on the record. Correct it below — the search covers BiniLyrics, PaxSenix, BetterLyrics and LRCLIB.",
  'lyrics.clearSavedName': 'Clear saved name',
  'lyrics.searchHint': "Search all providers with the recording's real name:",
  'lyrics.search': 'Search',
  'lyrics.instrumental': 'Instrumental',
  'lyrics.adjustTiming': 'Adjust timing',
  'lyrics.offsetTitle': 'Lyrics timing',
  'lyrics.offsetHint': 'Lyrics ahead of the song? Nudge them back. Behind? Nudge them forward.',
  'lyrics.reset': 'Reset',
  'lyrics.clearSaved': 'Clear saved',
  'lyrics.done': 'Done',
  'lyrics.source': 'Lyrics from {provider}',
  'lyrics.wordSync': 'WORD SYNC',
  'lyrics.synced': 'SYNCED',
  'lyrics.offsetApplied': 'Offset {value}',

  'settings.title': 'Settings',
  'settings.guestNotice': 'Guest mode — likes, playlists and history are stored on this device.',
  'settings.theme': 'Theme',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'settings.syncedLyrics': 'Synced lyrics',
  'settings.autoPlay': 'AutoPlay (radio after queue ends)',
  'settings.crossfade': 'Crossfade',
  'crossfade.off': 'Off',
  'crossfade.s': '{s}s',
  'settings.dataSaver': 'Data saver (prefer lowest bitrate)',
  'settings.language': 'Language',
  'language.en': 'English',
  'language.ja': '日本語',
  'sources.title': 'Sources',
  'sources.add': 'Add',
  'sources.save': 'Save source',
  'sources.customTag': '· custom',
  'sources.test': 'Test',
  'sources.remove': 'Remove',
  'sources.builtIns': 'Built-ins: ',
  'sources.upToast': '{name} is up',
  'sources.downToast': '{name} is down',
  'sources.enterUrl': 'Enter a full https:// URL',
  'sources.onlyHttps': 'Only https:// instances are supported',
  'sources.duplicate': 'That source is already in the list',
  'sources.addedToast': 'Added {host}',
  'settings.footer': 'BitChord web — GPL v3. Not affiliated with YouTube or Google.',

  'menu.playNext': 'Play next',
  'menu.addToQueue': 'Add to queue',
  'menu.likeRemove': 'Remove from Liked songs',
  'menu.likeAdd': 'Add to Liked songs',
  'menu.addToPlaylist': 'Add to playlist',
  'menu.back': 'Back',
  'menu.noPlaylists': 'No playlists yet — make one below.',
  'menu.newPlaylistName': 'New playlist name',
  'menu.create': 'Create',
  'menu.addedToast': 'Added to {title}',

  'toast.addedToQueue': 'Added to queue',
  'toast.playingNext': 'Playing next',
  'toast.likedAdded': 'Added to Liked songs',
  'toast.likedRemoved': 'Removed from Liked songs',
  'toast.addedToPlaylist': 'Added to {title}',
  'toast.addedToPlaylistPlain': 'Added to playlist',

  'aria.previous': 'Previous',
  'aria.next': 'Next',
  'aria.play': 'Play',
  'aria.pause': 'Pause',
  'aria.back': 'Back',
  'aria.close': 'Close',
  'aria.clear': 'Clear',
  'aria.mute': 'Mute',
  'aria.unmute': 'Unmute',
  'aria.settings': 'Settings',
  'aria.nowPlaying': 'Now playing',
  'aria.shuffle': 'Shuffle',
  'aria.repeat': 'Repeat',
  'aria.speed': 'Playback speed',
  'aria.volume': 'Volume',
  'aria.queue': 'Queue',
  'aria.lyrics': 'Lyrics',
  'aria.like': 'Like',
  'aria.deletePlaylist': 'Delete {title}',
  'aria.songTitle': 'Song title',
  'aria.artist': 'Artist',
  'aria.instrumental': 'Instrumental',
  'aria.more': 'More',
  'lyrics.changeProvider': 'Change lyrics provider',
};

const ja: Dict = {
  'tab.home': 'ホーム',
  'tab.explore': '探索',
  'tab.library': 'ライブラリ',
  'tab.search': '検索',

  'msg.tryAgain': '再試行',
  'msg.somethingWrong': 'エラーが発生しました',
  'msg.nothingHere': '何もありません',

  'common.guestTitle': 'ゲストとして試聴中',
  'common.guestBody': 'サインインは Web 版では利用できません。いいね・プレイリスト・履歴はこの端末に保存されます。',
  'common.playlist': 'プレイリスト',

  'home.recents': '最近聴いた曲',
  'home.error': 'フィードを読み込めませんでした',

  'explore.title': '探索',
  'explore.error': '探索を読み込めませんでした',
  'explore.moodError': 'このムードを読み込めませんでした',
  'explore.moodEmpty': 'このムードにはまだコンテンツがありません。',

  'library.title': 'ライブラリ',
  'library.playlists': 'プレイリスト',
  'library.newPlaylist': '新規プレイリスト',
  'library.playlistTitle': 'プレイリスト名',
  'library.create': '作成',
  'library.noPlaylists': 'まだプレイリストがありません。',
  'library.deletedToast': '{title} を削除しました',
  'library.likedSongs': 'お気に入り',
  'library.playAll': 'すべて再生',
  'library.likedEmpty': 'いいねした曲はここにまとめられ、この端末に保存されます。',
  'library.showAllSongs': '全 {n} 曲を表示',
  'library.history': '履歴',
  'library.playsEmpty': '視聴履歴はここに記録されます。',
  'library.showAllPlays': '全 {n} 回を表示',
  'library.showLess': '表示を減らす',

  'playlist.oneSong': '1 曲',
  'playlist.songs': '{n} 曲',
  'playlist.play': '再生',
  'playlist.shuffle': 'シャッフル',
  'playlist.removedToast': 'プレイリストから削除しました',
  'playlist.empty': '空のプレイリストです。行のメニューから曲を追加できます。',

  'search.placeholder': '曲・アーティスト・アルバムを検索',
  'search.failed': '検索に失敗しました',
  'filter.all': 'すべて',
  'filter.songs': '曲',
  'filter.videos': '動画',
  'filter.albums': 'アルバム',
  'filter.artists': 'アーティスト',
  'filter.playlists': 'プレイリスト',
  'type.album': 'アルバム',
  'type.artist': 'アーティスト',
  'type.playlist': 'プレイリスト',

  'detail.loadError': 'このページを読み込めませんでした',
  'detail.empty': 'このページから曲を解析できませんでした。',

  'player.retry': '再試行',
  'player.playbackSpeed': '再生速度',
  'player.sleepTimer': 'スリープタイマー',
  'player.volume': '音量',
  'player.queue': 'キュー',
  'player.lyricsTitle': '歌詞',

  'queue.title': 'キュー',
  'queue.clear': 'クリア',
  'queue.clearedToast': '次の曲をクリアしました',
  'queue.nowPlaying': '再生中',
  'queue.nextUp': '次の曲 · {n}',
  'queue.emptyLoop': '他にありません — この曲の終了後、キューは最初からループします。',
  'queue.emptyRepeat': '他にありません — この曲が終わると繰り返します。',
  'queue.emptyAutoplay': '他にありません — AutoPlay がこの後も曲を続けます。',
  'queue.emptyAdd': '他にありません — 任意の行の ⋯ メニューから曲を追加できます。',
  'queue.moveUp': '上へ移動',
  'queue.moveDown': '下へ移動',

  'sleep.title': 'スリープタイマー',
  'sleep.stoppingIn': 'あと {time} で停止',
  'sleep.min': '{m} 分',
  'sleep.cancel': 'タイマーを取り消す',

  'lyrics.providerFallback': '歌詞',
  'lyrics.searching': '検索中…',
  'lyrics.noLyrics': '歌詞が見つかりませんでした',
  'lyrics.titleFixBody': 'YouTube のタイトルが実際の楽曲名と異なることがあります。下で修正して検索できます — BiniLyrics、PaxSenix、BetterLyrics、LRCLIB に対応。',
  'lyrics.clearSavedName': '保存した名前をクリア',
  'lyrics.searchHint': '実際の楽曲名で全プロバイダを検索:',
  'lyrics.search': '検索',
  'lyrics.instrumental': 'インストルメンタル',
  'lyrics.adjustTiming': 'タイミングを調整',
  'lyrics.offsetTitle': '歌詞のタイミング',
  'lyrics.offsetHint': '歌詞が曲より進んでいますか？ 戻してください。遅れていますか？ 進めてください。',
  'lyrics.reset': 'リセット',
  'lyrics.clearSaved': '保存データをクリア',
  'lyrics.done': '完了',
  'lyrics.source': '{provider} の歌詞',
  'lyrics.wordSync': 'ワードシンク',
  'lyrics.synced': 'シンク',
  'lyrics.offsetApplied': 'オフセット {value}',

  'settings.title': '設定',
  'settings.guestNotice': 'ゲストモード — いいね・プレイリスト・履歴はこの端末に保存されます。',
  'settings.theme': 'テーマ',
  'theme.system': 'システム',
  'theme.light': 'ライト',
  'theme.dark': 'ダーク',
  'settings.syncedLyrics': '同期歌詞',
  'settings.autoPlay': 'AutoPlay（キュー終了後にラジオを続ける）',
  'settings.crossfade': 'クロスフェード',
  'crossfade.off': 'オフ',
  'crossfade.s': '{s}秒',
  'settings.dataSaver': 'データセーバー（最低ビットレートを優先）',
  'settings.language': '言語',
  'language.en': 'English',
  'language.ja': '日本語',
  'sources.title': 'ソース',
  'sources.add': '追加',
  'sources.save': 'ソースを保存',
  'sources.customTag': '· カスタム',
  'sources.test': 'テスト',
  'sources.remove': '削除',
  'sources.builtIns': '内蔵: ',
  'sources.upToast': '{name} は応答しています',
  'sources.downToast': '{name} は応答していません',
  'sources.enterUrl': 'https:// で始まる完全な URL を入力してください',
  'sources.onlyHttps': 'https:// のインスタンスのみ対応しています',
  'sources.duplicate': 'このソースは既に追加されています',
  'sources.addedToast': '{host} を追加しました',
  'settings.footer': 'BitChord web — GPL v3。YouTube / Google とは提携していません。',

  'menu.playNext': '次に再生',
  'menu.addToQueue': 'キューに追加',
  'menu.likeRemove': 'お気に入りから削除',
  'menu.likeAdd': 'お気に入りに追加',
  'menu.addToPlaylist': 'プレイリストに追加',
  'menu.back': '戻る',
  'menu.noPlaylists': 'まだプレイリストがありません — 下から作成できます。',
  'menu.newPlaylistName': '新しいプレイリスト名',
  'menu.create': '作成',
  'menu.addedToast': '{title} に追加しました',

  'toast.addedToQueue': 'キューに追加しました',
  'toast.playingNext': '次に再生',
  'toast.likedAdded': 'お気に入りに追加しました',
  'toast.likedRemoved': 'お気に入りから削除しました',
  'toast.addedToPlaylist': '{title} に追加しました',
  'toast.addedToPlaylistPlain': 'プレイリストに追加しました',

  'aria.previous': '前の曲',
  'aria.next': '次の曲',
  'aria.play': '再生',
  'aria.pause': '一時停止',
  'aria.back': '戻る',
  'aria.close': '閉じる',
  'aria.clear': 'クリア',
  'aria.mute': 'ミュート',
  'aria.unmute': 'ミュート解除',
  'aria.settings': '設定',
  'aria.nowPlaying': '再生中の曲',
  'aria.shuffle': 'シャッフル',
  'aria.repeat': 'リピート',
  'aria.speed': '再生速度',
  'aria.volume': '音量',
  'aria.queue': 'キュー',
  'aria.lyrics': '歌詞',
  'aria.like': 'いいね',
  'aria.deletePlaylist': '{title} を削除',
  'aria.songTitle': '曲名',
  'aria.artist': 'アーティスト名',
  'aria.instrumental': 'インストルメンタル（歌詞なし）',
  'aria.more': 'その他',
  'lyrics.changeProvider': '歌詞プロバイダを変更',
};

let language: Language = 'en';

/**
 * Optional live source. store.ts wires this to `state.settings.language` so
 * `t()` is synchronous with the first render and every re-render, with no
 * per-component subscription needed (screens re-render on store updates).
 */
type LangSource = () => Language;
let langSource: LangSource | null = null;

export function setLanguageSource(source: LangSource | null): void {
  langSource = source;
  setLanguage(source?.() ?? 'en');
}

export function getLanguage(): Language {
  return langSource ? langSource() : language;
}

/** Fallback setter for when no store source is wired (tests, previews). */
export function setLanguage(lang: Language): void {
  language = lang === 'ja' ? 'ja' : 'en';
}

export function t(key: string, params?: Record<string, string | number>): string {
  const lang = getLanguage();
  const dict = lang === 'ja' ? ja : en;
  let text = dict[key] ?? en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
