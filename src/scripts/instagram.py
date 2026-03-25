#!/usr/bin/env python3
import sys
import json
import instaloader
from datetime import datetime, timezone

def get_instagram_data(username: str):
    try:
        L = instaloader.Instaloader(
            download_pictures=False,
            download_videos=False,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
            quiet=True,
        )

        profile = instaloader.Profile.from_username(L.context, username)

        # Calcular dias desde último post
        posts = profile.get_posts()
        ultimo_post_dias = None
        try:
            primeiro_post = next(iter(posts))
            if primeiro_post:
                delta = datetime.now(timezone.utc) - primeiro_post.date_utc
                ultimo_post_dias = delta.days
        except StopIteration:
            ultimo_post_dias = 999

        result = {
            "username": profile.username,
            "followers": profile.followers,
            "bio": profile.biography,
            "ultimo_post_dias": ultimo_post_dias,
            "ativo": ultimo_post_dias is not None and ultimo_post_dias < 90,
            "is_private": profile.is_private,
            "full_name": profile.full_name,
        }

        # Buscar WhatsApp na bio
        import re
        wa_match = re.search(r'(?:wa\.me/|whatsapp[:\s]+)(\+?[\d\s\-\(\)]{10,})', profile.biography or '', re.IGNORECASE)
        if wa_match:
            result["whatsapp_na_bio"] = re.sub(r'[^\d+]', '', wa_match.group(1))

        # Buscar telefone qualquer na bio
        phone_match = re.search(r'(\+?55\s?(?:\d{2})\s?(?:9\d{4}|\d{4})-?\d{4})', profile.biography or '')
        if phone_match:
            result["telefone_na_bio"] = re.sub(r'[^\d+]', '', phone_match.group(1))

        print(json.dumps(result, ensure_ascii=False))

    except instaloader.exceptions.ProfileNotExistsException:
        print(json.dumps({"error": "profile_not_found"}))
    except instaloader.exceptions.PrivateProfileNotFollowedException:
        print(json.dumps({"error": "private_profile", "username": username}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    username = sys.argv[1] if len(sys.argv) > 1 else ""
    if not username:
        print(json.dumps({"error": "username required"}))
        sys.exit(1)
    get_instagram_data(username)
