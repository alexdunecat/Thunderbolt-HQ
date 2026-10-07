/* Лист журнала для Памятки пилота: оформление Штаба (скин из настроек системы). */
export class TBMemoSheet extends JournalSheet {
  static get defaultOptions() {
    const o = super.defaultOptions;
    return foundry.utils.mergeObject(o, { classes: [...o.classes, "tb-memo-sheet"], width: 880, height: 780 });
  }
}
