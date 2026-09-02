PRAGMA foreign_keys = ON;

UPDATE mixtapes
SET title = CASE id
  WHEN 'velvet-static' THEN 'Soft'
  WHEN 'midnight-circuit' THEN 'Night'
  WHEN 'heatwave-fm' THEN 'Heat'
  WHEN 'concrete-voltage' THEN 'Heavy'
  WHEN 'crash-and-friends' THEN 'Collabs'
  WHEN 'boom-bap-broadcast' THEN 'Soul'
  WHEN 'crash-classics' THEN 'Classics'
  WHEN 'rap-signal' THEN 'Rap'
  WHEN 'aftershock-trap' THEN 'Trap'
  ELSE title
END,
updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
  'velvet-static', 'midnight-circuit', 'heatwave-fm', 'concrete-voltage',
  'crash-and-friends', 'boom-bap-broadcast', 'crash-classics', 'rap-signal',
  'aftershock-trap'
);

UPDATE tracks
SET title = CASE id
  WHEN 'regular-guit-2' THEN 'Guit 2'
  WHEN 'regular-lofi' THEN 'Lofi'
  WHEN 'bap-recolection' THEN 'Recolection'
  WHEN 'regular-45' THEN '45'
  WHEN 'regular-ch' THEN 'Ch'
  WHEN 'regular-erre' THEN 'Erre'
  WHEN 'trap-insaninty' THEN 'Insaninty'
  WHEN 'featured-crash-x-bailey-1' THEN 'Crash X Bailey 1'
  WHEN 'featured-crash-x-bailey-2' THEN 'Crash X Bailey 2'
  WHEN 'featured-isn-ft-big-slay' THEN 'Isn'
  WHEN 'featured-kl-ft-big-slay' THEN 'Kl'
  WHEN 'featured-ybg-2-ft-bailey-sample' THEN 'Ybg 2'
  WHEN 'bap-diller-no-little-boy' THEN 'Diller No Little Boy'
  WHEN 'classic-prog-3-copy' THEN 'Prog 3 Copy'
  WHEN 'regular-ybg-1' THEN 'Ybg 1'
  WHEN 'regular-amb' THEN 'Amb'
  WHEN 'regular-ebo-2' THEN 'Ebo 2'
  WHEN 'trap-opera-mastwer' THEN 'Opera Mastwer'
  WHEN 'regular-cc' THEN 'Cc'
  ELSE title
END,
updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
  'regular-guit-2', 'regular-lofi', 'bap-recolection', 'regular-45',
  'regular-ch', 'regular-erre', 'trap-insaninty',
  'featured-crash-x-bailey-1', 'featured-crash-x-bailey-2',
  'featured-isn-ft-big-slay', 'featured-kl-ft-big-slay',
  'featured-ybg-2-ft-bailey-sample', 'bap-diller-no-little-boy',
  'classic-prog-3-copy', 'regular-ybg-1', 'regular-amb', 'regular-ebo-2',
  'trap-opera-mastwer', 'regular-cc'
);

WITH assignments(track_id, mixtape_id, track_order) AS (
  VALUES
    ('regular-guit-2', 'velvet-static', 0),
    ('regular-mama', 'velvet-static', 1),
    ('regular-lofi', 'velvet-static', 2),
    ('regular-remember', 'velvet-static', 3),
    ('classic-so-funny-i-ran-into-you-master-ultra', 'velvet-static', 4),
    ('classic-accept-it', 'velvet-static', 5),
    ('bap-recolection', 'velvet-static', 6),
    ('bap-tape', 'velvet-static', 7),
    ('bap-a-drug-song', 'velvet-static', 8),
    ('trap-you-and-i', 'velvet-static', 9),

    ('classic-perspective', 'midnight-circuit', 0),
    ('classic-one-million-cash', 'midnight-circuit', 1),
    ('regular-guit', 'midnight-circuit', 2),
    ('regular-somebody', 'midnight-circuit', 3),
    ('regular-let-go', 'midnight-circuit', 4),
    ('regular-45', 'midnight-circuit', 5),
    ('regular-reverse', 'midnight-circuit', 6),
    ('trap-divine', 'midnight-circuit', 7),
    ('trap-ultra', 'midnight-circuit', 8),
    ('trap-the-mayor', 'midnight-circuit', 9),

    ('regular-afro', 'heatwave-fm', 0),
    ('regular-dance', 'heatwave-fm', 1),
    ('regular-filth', 'heatwave-fm', 2),
    ('regular-wonder', 'heatwave-fm', 3),
    ('regular-ch', 'heatwave-fm', 4),
    ('bap-shibuya', 'heatwave-fm', 5),
    ('rap-nineteen', 'heatwave-fm', 6),
    ('rap-don', 'heatwave-fm', 7),
    ('rap-tevis-scoot', 'heatwave-fm', 8),
    ('rap-never-gon-run-out', 'heatwave-fm', 9),

    ('regular-cari', 'concrete-voltage', 0),
    ('regular-erre', 'concrete-voltage', 1),
    ('regular-unique', 'concrete-voltage', 2),
    ('regular-boompa', 'concrete-voltage', 3),
    ('regular-going', 'concrete-voltage', 4),
    ('regular-bent', 'concrete-voltage', 5),
    ('trap-insaninty', 'concrete-voltage', 6),
    ('classic-crash-beat-master', 'concrete-voltage', 7),
    ('rap-dont-know', 'concrete-voltage', 8),
    ('rap-ger-master', 'concrete-voltage', 9),

    ('regular-air-fryer', 'boom-bap-broadcast', 0),
    ('regular-west', 'boom-bap-broadcast', 1),
    ('regular-bryson', 'boom-bap-broadcast', 2),
    ('regular-sade', 'boom-bap-broadcast', 3),
    ('regular-minimum-wage', 'boom-bap-broadcast', 4),
    ('regular-you-are-mine', 'boom-bap-broadcast', 5),
    ('bap-look-at-you-tonight-beat', 'boom-bap-broadcast', 6),
    ('bap-crymeariver', 'boom-bap-broadcast', 7),
    ('bap-diller-no-little-boy', 'boom-bap-broadcast', 8),
    ('rap-percy-leaving', 'boom-bap-broadcast', 9),

    ('classic-might-have-you-later-ultra', 'crash-classics', 0),
    ('classic-same-place-20c', 'crash-classics', 1),
    ('classic-prog-3-copy', 'crash-classics', 2),
    ('classic-middle-age', 'crash-classics', 3),
    ('regular-ybg-1', 'crash-classics', 4),
    ('regular-answer', 'crash-classics', 5),
    ('regular-amb', 'crash-classics', 6),
    ('rap-dont-matter', 'crash-classics', 7),
    ('bap-bout-damn-time', 'crash-classics', 8),
    ('bap-wave-after', 'crash-classics', 9),

    ('regular-doodly', 'rap-signal', 0),
    ('regular-strrrr', 'rap-signal', 1),
    ('regular-twiz', 'rap-signal', 2),
    ('regular-ebo-2', 'rap-signal', 3),
    ('regular-squeak', 'rap-signal', 4),
    ('rap-circles-1', 'rap-signal', 5),
    ('rap-cranium', 'rap-signal', 6),
    ('rap-traps', 'rap-signal', 7),
    ('trap-opera-mastwer', 'rap-signal', 8),
    ('trap-kick-back', 'rap-signal', 9),

    ('trap-greatness', 'aftershock-trap', 0),
    ('trap-808s-asf', 'aftershock-trap', 1),
    ('trap-meant-that-104', 'aftershock-trap', 2),
    ('regular-cc', 'aftershock-trap', 3),
    ('regular-pastrami', 'aftershock-trap', 4),
    ('regular-doom', 'aftershock-trap', 5),
    ('regular-fine', 'aftershock-trap', 6),
    ('regular-blump-beat', 'aftershock-trap', 7),
    ('regular-moon', 'aftershock-trap', 8),
    ('rap-808seem', 'aftershock-trap', 9)
)
UPDATE tracks
SET mixtape_id = (
      SELECT assignments.mixtape_id
      FROM assignments
      WHERE assignments.track_id = tracks.id
    ),
    sort_order = (
      SELECT assignments.track_order
      FROM assignments
      WHERE assignments.track_id = tracks.id
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT track_id FROM assignments);
