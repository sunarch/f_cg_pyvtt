"""
https://github.com/cgloeckner/pyvtt/

Copyright (c) 2020-2023 Christian Glöckner
License: MIT (see LICENSE for details)
"""

import unittest

from vtt import utils
from .mock import LoginMock


class GoogleLoginTest(unittest.TestCase):

    def on_auth(self, data: dict) -> None:
        self.last_auth = data

    def setUp(self) -> None:
        self.last_auth = None

        self.client = LoginMock()
        self.api = utils.GoogleLogin(self.client, self.on_auth, 'https://my-server.com/api',
                                     client_id='0t8ue89g9ge5tvwt', client_secret='34954hb6u40e56ue506z7hu50ez9u50zgu',
                                     icon_url='htts://example.com/google.png')

    def test_constructor(self) -> None:
        self.assertEqual(self.api.callback, 'https://my-server.com/api/google')
        self.assertEqual(self.api.login_caption, 'Login with google')

    def test_get_auth_url(self) -> None:
        url = self.api.get_auth_url()
        data = {pair.split('=')[0]: '='.join(pair.split('=')[1:]) for pair in url.split('?')[1].split('&')}

        self.assertEqual(data['client_id'], self.api.client_id)
        redirect_uri = data['redirect_uri'].replace('%2F', '/').replace('%3A', ':')
        self.assertEqual(redirect_uri, self.api.callback)

        scopes = data['scope'].replace('%2F', '/').replace('%3A', ':')
        self.assertTrue(scopes, self.api.scopes)
