-- Видео в медиатеке: MP4-файл, а в thumb_name — кадр-обложка в WebP
ALTER TABLE media ADD COLUMN kind text NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video'));
ALTER TABLE media ADD COLUMN duration real;
