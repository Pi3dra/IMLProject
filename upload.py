import os
import requests

def main():
    backend_url = 'http://localhost:3030'
    dataset_name = 'TrainingSet'
    image_root = 'Dataset_resized'

    print("Loading images into Marcelle dataset...")

    for root, _, files in os.walk(image_root):
        label = os.path.basename(root)
        if not label:
            continue
        for file in files:
            if not file.lower().endswith(('.jpg', '.jpeg')):
                continue
            file_path = os.path.join(root, file)
            try:
                with open(file_path, 'rb') as f:
                    files_data = {'uri': (file, f, 'image/jpeg')}
                    upload_response = requests.post(f'{backend_url}/assets', files=files_data)
                    upload_response.raise_for_status()
                    resp_data = upload_response.json()
                    # Path returned by feathers-blob service (usually /uploads/<id> or similar)
                    asset_path = resp_data.get('uri') or f'/assets/{resp_data.get("id", file)}'

                instance = {
                    'x': asset_path,
                    'y': label,
                    'thumbnail': asset_path
                }
                create_response = requests.post(f'{backend_url}/{dataset_name}', json=instance)
                create_response.raise_for_status()

                print(f'Successfully added {file} with label "{label}" (asset path: {asset_path})')
            except requests.exceptions.RequestException as e:
                print(f'Error processing {file_path}: {e}')
                # Print more details if available
                if hasattr(e.response, 'text'):
                    print(f'Server response: {e.response.text}')

    print('Dataset loading complete. Refresh your Marcelle dashboard to view the data.')

if __name__ == '__main__':
    main()
