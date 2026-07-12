# Knowledge Engine

## Amaç

Belgelerden çıkarılan bilgileri entity, alias ve relationship olarak yönetmek.

## Entity

Entity örnekleri:

- Ali Zeki Çobanoğlu
- Baki Toksal
- Hasan Tahsin Merter
- Beykoz
- 248 Parsel
- A-8 Sulh ve Taksim Anlaşması

## Alias Resolution

Farklı yazımlar aynı canonical entity altında toplanmalıdır.

Örnek:

```text
Ali Çobanoğlu
Ali Zeki Çobanoğlu
Ali Çavanoğlu
A. Çobanoğlu
```

## Entity Merge

Kullanıcı iki entity'yi UI üzerinden birleştirebilmelidir.

## Relationships

Örnek ilişki türleri:

- taraf
- vekil
- vekalet veren
- borçlu
- alacaklı
- parsel ile ilişkili
- miras ilişkisi
- satış ilişkisi
- taksim ilişkisi
- belge içinde birlikte geçiyor

## Evidence

Her ilişki evidence_snippet taşımalıdır.

## Entity Detail

Entity detayında:

- canonical name
- aliases
- type
- geçtiği belgeler
- ilişkili entity'ler
- evidence snippets
- kullanıcı düzeltmeleri

görünmelidir.
