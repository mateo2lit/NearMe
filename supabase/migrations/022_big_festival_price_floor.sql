-- Follow-up to 021. The festival price floor was $50, which a $59.65
-- neighborhood moon festival cleared — it stayed in Big Events next to
-- Dolphins vs Chiefs. The classifier's floor is now $100 (Ultra and Rolling
-- Loud passes run several hundred), so strip the tags from festival rows that
-- sit under the new bar.

update events
set tags = coalesce(
  (select array_agg(t order by t) from unnest(tags) t
   where t <> 'big_event' and t not like 'big-%'),
  '{}'::text[]
)
where tags && array['big_event']
  and title ~* '\yfest(ival)?\y'
  and coalesce(price_min, 0) < 100;
