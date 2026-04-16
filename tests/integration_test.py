import requests
import sys


def check_integration(url):
    print(f"Проверка начала сессии по адресу {url}")
    try:
        form_data = {
            "group": "0000",
            "surname": "Tester",
            "name": "Test",
            "patronymic": "Testerovich",
            "work_title": "http://test.com"
        }

        print(f"Создана форма {form_data} для интеграционного тестирования")

        response = requests.post(url, data=form_data)
        
        assert response.status_code == 201, f"Ошибка начала сессии. Статус: {response.status_code}. Ответ: {response.text}"

        print(f"Сессия успешно начата с id {response.text}")
    except Exception as e:
        print(f'Произошла ошибка: {e}')
        sys.exit(1)


if __name__ == "__main__":
    print("---")
    print("Интеграционный тест (начало сессии)")
    check_integration(f"http://localhost:5000/start_session")
    print("---")