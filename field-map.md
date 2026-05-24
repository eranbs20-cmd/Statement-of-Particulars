# מפת שדות סופית — הרצאת פרטים (טופס 4)

**גרסה: details-v4** · **253 שדות פעילים** · **26 סקציות**

האפליקציה ב-`details.html` עברה כיול איטרטיבי עם הזרקת נתוני דמה ריאליסטיים לכל 244 התאים הריקים שזוהו ב-`base.pdf`. אחרי 2 איטרציות, הקואורדינטות נקבעו כך שכל ערך נופל בדיוק בשדה הריק שלו.

---

## סיכום סקציות

| Section | סוג | מספר שדות | עמוד |
|---------|------|------------|------|
| `case` | fields | 2 | 0 |
| `parties` | fields | 6 | 0 |
| `history` | fields | 5 | 0 |
| `section_a_general` | fields | 4 | 0 |
| `prior_case_extra` | fields | 1 | 0 |
| `income_applicant` | isTable (12×3) | 36 | 0 |
| `income_defendant` | isTable (12×3) | 36 | 1 |
| `property_p1` | fields | 8 | 1 |
| `debts_p1` | fields | 8 | 1 |
| `banks_cars` | fields | 2 | 2 |
| `bank_accounts` | fields | 6 | 2 |
| `spouse` | fields | 2 | 2 |
| `spouse_table` | fields | 11 | 2 |
| `parents_minor` | fields | 6 | 2-3 |
| `parent_table` | fields | 8 | 2 |
| `other_children` | isTable (5×3) | 15 | 3 |
| `oc_def_p3` | fields | 12 | 3 |
| `spouse_kids_p3` | fields | 18 | 3 |
| `parent_kids_p3` | fields | 1 | 3 |
| `misc_p3` | fields | 11 | 3 |
| `residence_pq_p4` | fields | 16 | 4 |
| `oc_def_table_p4` | fields | 3 | 4 |
| `rel_3_1` | fields | 9 | 4 |
| `rel_3_2` | fields | 9 | 4 |
| `rel_4_1` | fields | 9 | 5 |
| `rel_4_2` | fields | 9 | 5 |
| **סה"כ** | | **253** | |

---

## תהליך הכיול

1. **Phase A**: יצירת אייקון מאזני צדק (`icon-192.png`, `icon-512.png`)
2. **Phase B**: זיהוי 244 תאים אוטומטית מ-`base.pdf` באמצעות זיהוי קווים אופקיים + אנכיים + שחזור grid → `cells-detected.json`
3. **Phase C - iter 1**: הזרקת דמה "P{page}-C{idx}" + רנדור — זוהו 52 תאים עם תווית פנימית
4. **Phase C - iter 2**: הזרקה מחדש עם `adj_x_right` מותאם-תווית (3pt לפני התווית) → `cells-calibrated.json`
5. **Phase D**: הזרקת ערכי דמה ריאליסטיים (שמות עברים, תאריכים, סכומים) ל-244 התאים — אומת ויזואלית בכל 6 העמודים
6. **Phase E**: הוספת 13 סקציות חדשות (107 שדות) ל-FORM_SCHEMA הקיים ב-`details.html`
7. **Phase F**: בדיקת end-to-end עם 253 ערכי דמה → 250 תאים נכתבו בהצלחה, 3 שדות `radio` דולגו (לוגיקה נפרדת)

---

## קבצים בתיקייה

| קובץ | תפקיד |
|------|--------|
| `details.html` | האפליקציה הראשית עם FORM_SCHEMA סופי |
| `base.pdf` | טופס מקור |
| `sw.js` | service worker (cache `details-v4`) |
| `manifest.json` | PWA מטא |
| `icon-192.png` + `icon-512.png` | אייקון מאזני צדק |
| `fonts/Heebo-Bold.ttf` | פונט עברית |
| **תיעוד פנימי**: | |
| `cells-detected.json` | 244 תאים גולמיים מהזיהוי האוטומטי |
| `cells-calibrated.json` | 244 תאים אחרי כיול תווית-מודעת |
| `FINAL_SCHEMA-ref.js` | סכמה חלופית של 231 שדות (לפי קואורדינטות בלבד) |
| `schema-fragment-todo.js` | סקציות שעודן לא הוטמעו (מקור היסטורי) |
| `field-map.md` | המסמך הזה |

---

## URL הפריסה

`https://eranbs20-cmd.github.io/Statement-of-Particulars/details.html`

(לאחר שתעלה את הקבצים ל-repo החדש; ראה הוראות בסיכומים קודמים)

---

## הערות לתחזוקה

- **עדכון קואורדינטות**: כל קואורדינטה נמצאת ב-`details.html` תחת `const FORM_SCHEMA = {...}`. חיפוש לפי `id` של השדה.
- **הוספת שדה חדש**: הוסף `{id:'...', label:'...', page:N, rightEdge:X, y:Y, maxWidth:W, size:S}` לאחת מהסקציות.
- **הוספת טבלה חדשה**: השתמש ב-`isTable: true` עם `prefix`, `yStart`, `yStep` (כמו `income_applicant`).
- **תיבת סימון**: השתמש ב-`type:'radio'` עם `coords:{yes:{x,y}, no:{x,y}}` (כמו ב-`parents_minor`).
- **קאש**: עלה את הגרסה ב-`sw.js` (`details-v4` → `details-v5`...) אחרי כל שינוי כדי לאלץ רענון במכשירי הלקוחות.
