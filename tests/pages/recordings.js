/** UI actions in 'My recordings'. File retention and returned data are asserted by tests. */
export class RecordingsPage {
  constructor(session) {
    this.session = session;
    this.page = null;
  }
  async open() {
    this.page = await this.session.context.newPage();
    await this.page.goto(this.session.url + '/pages/recordings.html');
    return this.page;
  }
  row(name) {
    return this.page.locator('article').filter({ has: this.page.getByText(name, { exact: true }) });
  }
  async refresh() {
    await this.page.locator('#refresh').click();
  }
  async download(name) {
    const row = this.row(name);
    await row.getByRole('button', { name: 'Скачать', exact: true }).click();
    await row.getByRole('button', { name: 'Показать в папке' }).waitFor();
    return this.page.evaluate(async () => {
      const [item] = await chrome.downloads.search({ limit: 1, orderBy: ['-startTime'] });
      return { id: item.id, state: item.state, filename: item.filename };
    });
  }
}
