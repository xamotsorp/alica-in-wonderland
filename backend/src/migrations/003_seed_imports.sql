-- Разовые импорты стартовых материалов (например, роликов из seed/videos):
-- запись появляется после успешного импорта, и повторно он не выполняется,
-- даже если карточку потом удалили в админке
CREATE TABLE seed_imports (
  key          text PRIMARY KEY,
  imported_at  timestamptz NOT NULL DEFAULT now()
);
