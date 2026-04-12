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

        import re

        # 1. WhatsApp no external_url (link na bio) — wa.me/NUMBER é o mais confiável
        external_url = getattr(profile, 'external_url', None) or ''
        if external_url:
            result["external_url"] = external_url
            wa_url_match = re.search(r'wa\.me/(\+?[\d]{10,14})', external_url, re.IGNORECASE)
            if wa_url_match:
                result["whatsapp_na_bio"] = re.sub(r'[^\d+]', '', wa_url_match.group(1))

        # 2. WhatsApp na bio (text)
        if not result.get("whatsapp_na_bio"):
            wa_match = re.search(r'(?:wa\.me/|whatsapp[:\s]+)(\+?[\d\s\-\(\)]{10,})', profile.biography or '', re.IGNORECASE)
            if wa_match:
                result["whatsapp_na_bio"] = re.sub(r'[^\d+]', '', wa_match.group(1))

        # 3. Telefone na bio — regex abrangente para formatos BR sem exigir +55
        # Cobre: (48) 99999-1234 / 48 9 9999-1234 / 48999991234 / +55 48 99999-1234
        if not result.get("telefone_na_bio") and not result.get("whatsapp_na_bio"):
            phone_match = re.search(
                r'(?:\+?55[\s.-]?)?'           # +55 ou 55 opcional
                r'(?:\(?(\d{2})\)?[\s.-]?)'    # DDD (com ou sem parênteses)
                r'(9\d{4}|\d{4})'              # Parte 1: 9XXXX (celular) ou XXXX (fixo)
                r'[\s.-]?(\d{4})',             # Parte 2: XXXX
                profile.biography or ''
            )
            if phone_match:
                ddd   = phone_match.group(1)
                part1 = phone_match.group(2)
                part2 = phone_match.group(3)
                result["telefone_na_bio"] = f"55{ddd}{part1}{part2}"

        # 4. Business phone number (conta business do Instagram)
        business_phone = getattr(profile, 'business_phone_number', None)
        if business_phone:
            result["business_phone"] = re.sub(r'[^\d+]', '', str(business_phone))

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
