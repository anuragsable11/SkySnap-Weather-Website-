"""Template filters for showing weather readings."""

from django import template

register = template.Library()


@register.filter
def minus(value):
    """Write a negative reading with a true minus sign, e.g. -2 -> '−2'.

    Python prints a hyphen, which sits short and low beside figures; the
    minus sign (U+2212) is the one used for temperatures in print.
    """
    if value is None:
        return value
    text = str(value)
    return '−' + text[1:] if text.startswith('-') else text
