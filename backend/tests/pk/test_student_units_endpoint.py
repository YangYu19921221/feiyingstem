import pytest


@pytest.mark.asyncio
async def test_list_units_in_book_returns_units(
    client, auth_student_token, sample_unit_with_words,
):
    token, _ = auth_student_token
    unit, _ = sample_unit_with_words
    book_id = unit.book_id
    resp = await client.get(
        f"/api/v1/student/books/{book_id}/units",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    units = resp.json()
    assert len(units) == 1
    assert units[0]["id"] == unit.id
    assert units[0]["name"] == "Unit 1: Animals"
    assert units[0]["unit_number"] == 1
