-- По умолчанию на кассе только «Наличные» и «Карта»: Click и Payme выключаются.
-- Их можно снова включить в панели: Настройки → Способы оплаты.
UPDATE "payment_methods" SET "active" = false WHERE "kind" = 'transfer' AND "name"->>'uz' IN ('Click', 'Payme');
