# Prepaid wallets (parking cards)

A company can give a regular customer a **wallet**: a prepaid balance that pays the parking fee when the
vehicle leaves. It works like a parking card. The customer pays money in at the counter; at the exit the
fee is taken from the wallet instead of cash.

A wallet belongs to one company and can only pay **that company's parking fees**. It is not a general
payment instrument: nothing can be bought with it and money cannot be taken out of it except as a refund
of a parking fee. (Ask your lawyer or accountant whether your use needs any licence or limit; this
software only enforces the balance limit you set below.)

## Day to day

1. **Create a wallet** (Dashboard > Wallets > New wallet): holder name, phone, up to 5 vehicles. It gets a
   number such as `W-K7QXMP4R`. A vehicle can be linked to one wallet of the company.
2. **Add money** at the counter (Operator > Wallets, or the wallet's own page): amount, paid by cash, UPI or
   card, and a UPI/card reference if there is one. Cash is counted in the operator's open shift, so the
   drawer total stays right.
3. **At the exit**, if the vehicle is linked to an active wallet, the exit screen offers *Wallet* and
   preselects it when the balance is enough. The operator can also type another wallet's number (the
   customer's card). The fee is taken, the session closes and the barrier opens as usual.
4. **Not enough balance**: the payment is refused, nothing is taken and the vehicle stays inside. Top the
   wallet up, or take another payment mode.
5. **Refund**: refunding a wallet payment (Locations admin, as for any payment) puts the money back into the
   same wallet. It does not touch any cash drawer.
6. **Block** a lost or misused wallet (reason required). A blocked wallet cannot pay or be topped up; a
   refund can still go back into it. Unblock it later.
7. **Correct a mistake** (Dashboard > Wallets > a wallet > Correct the balance): a plus or minus amount with a
   reason. Only a **company admin** can do this (a location admin can create and block wallets but not
   change a balance by hand). The wallet can never go below zero.

## How the money is counted

* Money put into a wallet is **not income yet**. It becomes income when a parking fee is paid from the
  wallet (that is a payment with method *Wallet* on the reports, collection and daily report).
* **Shifts**: top-ups count in the shift of the operator who took them (cash in the drawer, UPI and card
  by method). Fees paid from a wallet are shown ("paid from wallets") but are **not new collected money**
  and do not change the expected cash.
* **Daily collection** shows the day's wallet top-ups on their own, apart from the totals. The collection by
  vehicle type (screen, Excel, PDF) has a *Wallet* column, and its total counts the fee when it is paid from
  the wallet.
* **Two ways of counting.** A *shift* counts cash as it moves (top-ups in, wallet fees not new money). The
  *day's collection, the daily report and the reports* count income (wallet fees in, top-ups apart).
* **Ledger**: every change of a balance is one row (top-up, parking fee, refund, undone payment,
  correction) with who and when. Rows are never edited. *Check balance* on a wallet compares the balance
  with the sum of its rows.

## Safety rules the server keeps

* A balance change is **one atomic step** that also checks the rule (wallet active, enough money, under the
  limit). Many payments at the same moment cannot spend the same rupee twice.
* Each parking session can be paid from a wallet **once**. Sending the same payment again (a retry after a
  lost connection) finds the first one and takes nothing more. Top-ups and corrections accept a
  `requestId` that works the same way (the screens send one).
* If the payment cannot be recorded after the wallet was charged, the charge is **undone** automatically
  and shows in the history as "Undone". A payment that *was* recorded is never undone: two taps at the same
  moment give one payment. If the fee changed between two tries, an unrecorded charge is replaced by the new
  amount.
* A request id (top-up, correction) cannot be reused for a different amount.
* The wallet is never charged for a session someone else already paid.

## Settings

* `WALLET_MAX_BALANCE` (rupees, default 50000): a top-up that would take a wallet above this is refused.
* A single top-up must be between ₹1 and ₹1,00,000 with at most 2 decimals.
* Permission **Manage wallets** (`WALLET_MANAGE`): company admin and location admin by default; can be given
  to a custom role. Correcting a balance by hand is for the company admin only. Topping up and paying from a wallet need **Collect payments**.

## Not built yet

* Customers topping up themselves online (needs a customer login or a payment link per wallet).
* Texts or emails to the holder (low balance, top-up received, fee taken).
* Wallet cards with a QR code or an NFC/RFID tag (the number can be typed; a QR scanner on the exit screen
  already reads passes and can be extended).
* Wallets that work across several companies, expiry of unused balance, and cashback or bonus on top-ups.
* A report of all wallet balances owed (the total of the balances is money the company holds for its
  customers; ask your accountant how to show it).
