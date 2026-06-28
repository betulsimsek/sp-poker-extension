# SP Poker — Gizlilik Politikası

Son güncelleme: 27 Haziran 2026

## Toplanan Veriler

SP Poker, sprint planning poker oturumları sırasında aşağıdaki bilgileri toplar:

- **Kullanıcı adı**: Odaya katılırken girdiğin isim.
- **Oda kodu**: Oluşturulan veya katılınan oda için 6 haneli kod.
- **Task ID ve oylar**: Oylama sırasında girilen task ID'leri ve verdiğin story point oyları.

## Verilerin Kullanım Amacı

Bu veriler **yalnızca** oda içindeki diğer katılımcılarla gerçek zamanlı oylama
sonuçlarını senkronize etmek için kullanılır. Reklam, analiz veya üçüncü taraf
pazarlama amacıyla kullanılmaz, satılmaz.

## Verilerin Saklanması

Veriler Google Firebase Realtime Database üzerinde saklanır. Oda verileri
oturum süresince ve sınırlı bir süre sonrasında erişilebilir kalır; kalıcı
kullanıcı profili veya kimlik doğrulama bilgisi tutulmaz.

Yerel tarayıcı depolama (`chrome.storage`) sadece aktif oturumu (oda kodu, isim)
hatırlamak için kullanılır ve cihazından ayrılmaz.

## Üçüncü Taraf Paylaşımı

Veriler, Firebase (Google) dışında herhangi bir üçüncü tarafla paylaşılmaz.

## İletişim

Sorularınız için: eylulbetulsimsek@gmail.com
