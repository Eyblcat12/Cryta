SELECT json_build_object(
  'migration', (SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1),
  'tables', (
    SELECT json_agg(json_build_object(
      'name', t.relname,
      'columns', (
        SELECT json_agg(json_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'notNull', a.attnotnull,
          'primary', EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=t.oid AND c.contype='p' AND a.attnum=ANY(c.conkey)),
          'foreign', EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=t.oid AND c.contype='f' AND a.attnum=ANY(c.conkey))
        ) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
      ),
      'constraints', (
        SELECT json_agg(json_build_object('name', c.conname, 'kind', c.contype, 'definition', pg_get_constraintdef(c.oid)) ORDER BY c.conname)
        FROM pg_constraint c WHERE c.conrelid=t.oid
      )
    ) ORDER BY t.relname)
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relkind='r'
  ),
  'relations', (
    SELECT json_agg(json_build_object('source', s.relname, 'target', t.relname, 'definition', pg_get_constraintdef(c.oid)) ORDER BY s.relname, c.conname)
    FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_class t ON t.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=s.relnamespace WHERE n.nspname='public' AND c.contype='f'
  )
);
