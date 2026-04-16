from playwright.sync_api import expect, Page
import re

def test_group_field_validation(page: Page, extension_id: str) -> None:
    page.goto(f"chrome-extension://{extension_id}/pages/index.html")

    group_input = page.locator("#group_input")

    group_input.fill("1234")
    expect(group_input).to_have_class(re.compile(r".*input-valid.*"))

    group_input.fill("12")
    expect(group_input).to_have_class(re.compile(r".*input-invalid.*"))

    group_input.fill("abcd")
    expect(group_input).to_have_class(re.compile(r".*input-invalid.*"))

    group_input.fill("12345")
    expect(group_input).to_have_class(re.compile(r".*input-invalid.*"))

    group_input.fill("12a4")
    expect(group_input).to_have_class(re.compile(r".*input-invalid.*"))


def test_name_field_validation(page: Page, extension_id: str) -> None:
    page.goto(f"chrome-extension://{extension_id}/pages/index.html")

    name_input = page.locator("#name_input")

    name_input.fill("Иван")
    expect(name_input).to_have_class(re.compile(r".*input-valid.*"))

    name_input.fill("Albus-Severus")
    expect(name_input).to_have_class(re.compile(r".*input-valid.*"))

    name_input.fill("Дон Pedro")
    expect(name_input).to_have_class(re.compile(r".*input-invalid.*"))

    name_input.fill("Юлий123")
    expect(name_input).to_have_class(re.compile(r".*input-invalid.*"))

    name_input.fill("иван")
    expect(name_input).to_have_class(re.compile(r".*input-invalid.*"))


def test_surname_field_validation(page: Page, extension_id: str) -> None:
    page.goto(f"chrome-extension://{extension_id}/pages/index.html")

    surname_input = page.locator("#surname_input")

    surname_input.fill("Петров")
    expect(surname_input).to_have_class(re.compile(r".*input-valid.*"))

    surname_input.fill("Smith-Johnson")
    expect(surname_input).to_have_class(re.compile(r".*input-valid.*"))

    surname_input.fill("Smith Johnson")
    expect(surname_input).to_have_class(re.compile(r".*input-invalid.*"))

    surname_input.fill("О'Коннор123")
    expect(surname_input).to_have_class(re.compile(r".*input-invalid.*"))

    surname_input.fill("петров")
    expect(surname_input).to_have_class(re.compile(r".*input-invalid.*"))


def test_patronymic_field_validation(page: Page, extension_id: str) -> None:
    page.goto(f"chrome-extension://{extension_id}/pages/index.html")

    patronymic_input = page.locator("#patronymic_input")

    patronymic_input.fill("Иванович")
    expect(patronymic_input).to_have_class(re.compile(r".*input-valid.*"))

    patronymic_input.fill("Александровна-Мария")
    expect(patronymic_input).to_have_class(re.compile(r".*input-valid.*"))

    patronymic_input.fill("Александровна Мария")
    expect(patronymic_input).to_have_class(re.compile(r".*input-invalid.*"))

    patronymic_input.fill("Иванович123")
    expect(patronymic_input).to_have_class(re.compile(r".*input-invalid.*"))

    patronymic_input.fill("иванович")
    expect(patronymic_input).to_have_class(re.compile(r".*input-invalid.*"))

def test_work_title_field_validation(page: Page, extension_id: str) -> None:
    page.goto(f"chrome-extension://{extension_id}/pages/index.html")

    work_title_input = page.locator("#work_title_input")


    work_title_input.fill("https://se.moevm.info/doku.php/start")
    expect(work_title_input).to_have_class(re.compile(r".*input-valid.*"))
        
def test_no_patronymic_checkbox_validation(page: Page, extension_id: str) -> None:
    page.goto(f"chrome-extension://{extension_id}/pages/index.html")

    checkbox = page.locator("#no_patronymic_checkbox")
    patronymic_input = page.locator("#patronymic_input")

    checkbox.click()
    expect(patronymic_input).to_be_disabled()