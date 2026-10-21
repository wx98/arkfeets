import os
import sys
import time
import re
import argparse
sys.dont_write_bytecode = True
from prts_paths import WORK_DIR, IMAGE_DIR, prepare_workspace
prepare_workspace()
import requests
from bs4 import BeautifulSoup
from tqdm import tqdm
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.edge.service import Service as EdgeService

# 搜索"立绘"文件的入口 URL
base_url = (
    "https://prts.wiki/index.php?title=%E7%89%B9%E6%AE%8A:%E6%90%9C%E7%B4%A2"
    "&limit=500&profile=images&search=%E7%AB%8B%E7%BB%98"
)

# 完整浏览器请求头，减少被识别为爬虫的概率
headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
}


def fetch_html(url, driver):
    """使用 Selenium 获取动态加载的搜索结果页。"""
    try:
        driver.get(url)
        # 显式等待搜索结果容器出现，避免拿到未渲染的骨架页
        WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.CLASS_NAME, "searchresults"))
        )
        return driver.page_source
    except Exception as e:
        print(f"使用 Selenium 获取网页 {url} 时发生错误: {e}")
        return None


def parse_image_links(html):
    """从搜索结果 HTML 中提取所有文件页面链接。"""
    soup = BeautifulSoup(html, "html.parser")
    search_results = soup.find("div", class_="searchresults")
    image_links = []
    if not search_results:
        print("未能找到搜索结果容器，请检查网页结构或 URL。")
        # 保存页面以便排查网页结构变化
        with open(WORK_DIR / "debug_page.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("已保存当前页面内容到 debug_page.html，用于调试分析")
        return image_links

    results = search_results.find_all("li", class_="mw-search-result")
    print(f"找到 {len(results)} 个搜索结果")

    for result in results:
        for link in result.find_all("a", href=True):
            href = link.get("href")
            # 仅保留指向"文件:立绘 ..."的页面链接
            if (
                href
                and "/w/%E6%96%87%E4%BB%B6:" in href
                and "%E7%AB%8B%E7%BB%98" in href
            ):
                if href.startswith("https://prts.wiki"):
                    image_page_url = href
                else:
                    image_page_url = "https://prts.wiki" + href
                if image_page_url not in image_links:
                    image_links.append(image_page_url)
                break  # 每个搜索结果只取一个链接

    print(f"总共提取到 {len(image_links)} 个图片链接")
    return image_links


def download_image(session, image_page_url, progress_bar=None):
    """
    下载单张立绘图片。

    返回 (status, image_page_url, image_path_or_reason)：
        status 取值：
            - "ok"       下载成功
            - "skip"     跳过（预备干员 / 文件已存在 / 非干员图片）
            - "missing"  页面结构异常（找不到标题或 fullImageLink）
            - "error"    网络/解析异常
    返回元组便于主流程分类统计。
    """
    max_retries = 5
    last_error = ""

    for attempt in range(max_retries):
        try:
            # 1. 拉取文件页面
            image_page_response = session.get(image_page_url, timeout=30)
            image_page_response.raise_for_status()
            image_page_response.encoding = "utf-8"

            page_soup = BeautifulSoup(image_page_response.text, "html.parser")

            # 2. 解析标题 -> 干员名 + 皮肤编号
            heading = page_soup.find("h1", id="firstHeading")
            if not heading:
                # 页面结构变化，直接视为失败
                if progress_bar:
                    progress_bar.update(1)
                return "missing", image_page_url, "no firstHeading"

            full_filename = heading.get_text(strip=True).replace("文件:", "")

            char_name = ""
            skin_number = ""
            match = re.match(r"立绘[ _](.+?)(?:[_ ](.*?))?\.png", full_filename)
            if match:
                char_name = match.group(1).strip()
                skin_number = match.group(2) if match.group(2) else ""
            else:
                # 退化方案：去掉"立绘"前缀取首段
                fallback = re.search(r"([^(]+)", full_filename)
                if fallback:
                    char_name = fallback.group(1).replace("立绘", "").strip()

            # 跳过预备干员等非目标条目
            if not char_name or char_name.startswith("预备干员"):
                if progress_bar:
                    progress_bar.update(1)
                return "skip", image_page_url, "non-operator"

            # 清理文件名非法字符
            char_name = re.sub(r'[\\/*?:"<>|]', "", char_name)
            skin_number = (
                re.sub(r'[\\/*?:"<>|]', "", skin_number) if skin_number else ""
            )

            # 3. 准备输出目录
            char_folder = os.path.join(os.getcwd(), char_name)
            if not os.path.exists(char_folder):
                os.makedirs(char_folder)

            image_name = (
                f"{char_name} {skin_number}.png" if skin_number else f"{char_name}.png"
            )
            image_path = os.path.join(char_folder, image_name)

            # 已存在则跳过
            if os.path.exists(image_path):
                if progress_bar:
                    progress_bar.update(1)
                return "skip", image_page_url, "exists"

            # 4. 找到 fullImageLink 拿到原图 URL
            full_image_link = page_soup.find(
                "div", class_="fullImageLink", id="file"
            )
            if not full_image_link:
                if progress_bar:
                    progress_bar.update(1)
                return "missing", image_page_url, "no fullImageLink"

            a_tag = full_image_link.find("a")
            if not a_tag or not a_tag.get("href"):
                if progress_bar:
                    progress_bar.update(1)
                return "missing", image_page_url, "no <a> in fullImageLink"

            image_download_url = a_tag.get("href")

            # 5. 下载原图（超时设长一些，原图体积可能较大）
            image_download_response = session.get(
                image_download_url, timeout=60
            )
            image_download_response.raise_for_status()
            with open(image_path, "wb") as f:
                f.write(image_download_response.content)

            if progress_bar:
                progress_bar.update(1)
            return "ok", image_page_url, image_path

        except requests.RequestException as e:
            last_error = f"{type(e).__name__}: {e}"
            if attempt < max_retries - 1:
                # 指数退避：2, 4, 8, 16, 32 秒
                wait_time = 2 ** (attempt + 1)
                print(
                    f"\n[重试 {attempt + 1}/{max_retries}] {image_page_url} "
                    f"网络异常: {last_error}，{wait_time}秒后重试..."
                )
                time.sleep(wait_time)
                continue
            break
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
            if attempt < max_retries - 1:
                wait_time = 2 ** (attempt + 1)
                print(
                    f"\n[重试 {attempt + 1}/{max_retries}] {image_page_url} "
                    f"异常: {last_error}，{wait_time}秒后重试..."
                )
                time.sleep(wait_time)
                continue
            break

    # 所有重试用尽
    if progress_bar:
        progress_bar.update(1)
    return "error", image_page_url, last_error


def main():
    argparse.ArgumentParser(description="全量扫描 PRTS 立绘；已有文件自动跳过，无单干员模式").parse_args()
    print("正在启动浏览器...")
    edge_options = EdgeOptions()
    edge_options.add_argument("--disable-gpu")
    edge_options.add_argument(f"user-agent={headers['User-Agent']}")
    edge_options.add_argument(f"--user-data-dir={WORK_DIR / 'edge-profile'}")
    edge_options.add_argument(f"--disk-cache-dir={WORK_DIR / 'edge-cache'}")

    try:
        service = EdgeService()
        driver = webdriver.Edge(service=service, options=edge_options)
    except Exception as e:
        print(f"使用默认 Edge 驱动失败: {e}")
        print(
            "找不到 Edge 驱动，请确保已安装 Microsoft Edge 浏览器和对应的驱动程序"
        )
        return

    all_image_links = []
    offset = 0

    try:
        while True:
            print(f"\n正在处理页面，偏移量: {offset}...")
            url = f"{base_url}&offset={offset}"
            html = fetch_html(url, driver)

            if not html:
                print("无法获取 HTML，终止抓取。")
                break

            image_links = parse_image_links(html)
            if not image_links:
                print("当前页面未找到新的图片链接，抓取完成。")
                break

            all_image_links.extend(image_links)
            print(
                f"找到 {len(image_links)} 个新链接，总计 {len(all_image_links)} 个。"
            )
            offset += 500
            time.sleep(2)
    finally:
        driver.quit()
        print("浏览器已关闭。")

    if not all_image_links:
        print("未能获取到任何图片链接，程序退出。")
        return

    output_dir = str(IMAGE_DIR)
    os.chdir(output_dir)

    # 用 Session 复用 TCP 连接，减少握手开销
    session = requests.Session()
    session.headers.update(headers)

    print(f"\n开始下载 {len(all_image_links)} 张图片到 {output_dir} 文件夹...")
    print(
        "策略：单线程顺序下载 + Session 复用连接 + 0.5s 请求间隔 + 5 次指数退避重试"
    )

    # 分类记录
    failed = []         # 彻底失败的链接（含原因）
    missing = []        # 页面结构问题
    skipped = 0         # 跳过的条数（非干员 / 已存在）

    # 单线程顺序下载 —— 从根上消除并发触发的限速与 tqdm 多线程 Bug
    with tqdm(total=len(all_image_links), desc="下载进度", ncols=100) as progress_bar:
        for link in all_image_links:
            status, url, info = download_image(session, link, progress_bar)

            if status == "ok":
                pass
            elif status == "skip":
                skipped += 1
            elif status == "missing":
                missing.append((url, info))
            else:  # error
                failed.append((url, info))

            # 请求间隔，避免触发服务器限速
            time.sleep(0.5)

    # 汇总输出
    success_count = len(all_image_links) - len(failed) - len(missing) - skipped
    print("\n" + "=" * 60)
    print("下载完成！汇总：")
    print(f"  成功下载: {success_count}")
    print(f"  跳过(预备干员/已存在): {skipped}")
    print(f"  失败(网络/解析异常): {len(failed)}")
    print(f"  失败(页面结构异常): {len(missing)}")
    print("=" * 60)

    # 把失败链接落到文件，便于单独重试
    if failed or missing:
        with open(WORK_DIR / "failed_urls.txt", "w", encoding="utf-8") as f:
            f.write("# network/parse errors\n")
            for url, reason in failed:
                f.write(f"{url}\t{reason}\n")
            f.write("\n# missing/structure errors\n")
            for url, reason in missing:
                f.write(f"{url}\t{reason}\n")
        print("失败链接已写入 failed_urls.txt，可稍后单独重试")


if __name__ == "__main__":
    main()
