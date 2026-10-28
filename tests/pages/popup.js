export class PopupPage {
  constructor(session) {
    this.session = session;
    this.page = null;
  }

  async open() {
    if (!this.page || this.page.isClosed()) {
      this.page = await this.session.context.newPage();
      await this.page.goto(this.session.url + '/pages/index.html');
    }
    await this.page.bringToFront();
    return this.page;
  }

  async fillForm(values = {}) {
    const page = await this.open();
    const fields = {
      group: '9999',
      surname: 'Тестовый',
      name: 'Студент',
      patronymic: 'Тестович',
      title: 'Synthetic test',
      ...values,
    };
    for (const [name, value] of Object.entries(fields))
      await page.locator(`#${name}_input`).fill(value);
  }

  async requestPermissions() {
    await (await this.open()).locator('.record-section__button_permissions').click();
  }
  async start() {
    await (await this.open()).locator('.record-section__button_record-start').click();
  }
  async stop() {
    await (await this.open()).locator('.record-section__button_record-stop').click();
  }
  async save() {
    await (await this.open()).locator('.record-section__button_upload').click();
  }
}
