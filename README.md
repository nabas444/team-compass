Team Compass

A modern collaboration and task management platform designed to help teams organize work, manage groups, and track progress efficiently. Team Compass provides a centralized workspace for handling tasks, coordinating teams, and improving productivity through an intuitive interface.

🚀 Overview
Team Compass is a frontend-focused web application built with a cutting-edge tech stack. It emphasizes structured teamwork, task visibility, and seamless navigation across different project areas.
The platform enables users to:


Organize tasks within teams and groups


Track progress and manage workflows


Navigate projects with a structured routing system


Use reusable UI components for consistency


Visualize data and interactions in a clean dashboard



✨ Key Features
👥 Group & Team Management


Switch between different groups


Organize users into collaborative units


Structured team-based workflows


✅ Task Management


Create and manage tasks


View task details in interactive sheets


Track progress and updates


📊 Dashboard & Navigation


Centralized workspace for users


Sidebar-based navigation


Modular routing with scalable structure


🧩 UI Component System


Built with reusable UI components


Based on Radix UI + custom design system


Consistent styling across the app


📈 Data Visualization


Charts and visual components using Recharts


Improved data readability and insights


🎨 UI/UX


Clean, modern interface


Responsive design


Accessible and component-driven architecture



🛠️ Tech Stack
Frontend


React (TypeScript)


Vite


Tailwind CSS


Routing & Framework


TanStack Router


TanStack Start


State & Data


React Query (@tanstack/react-query)


React Hook Form + Zod


Backend Integration


Supabase (Auth, Database, APIs)


UI & Components


Radix UI


shadcn/ui


Lucide Icons


Additional Libraries


Recharts (data visualization)


Date-fns


Embla Carousel


Sonner (toasts/notifications)



📂 Project Structure
src/ ├── components/ │   ├── groups/ │   ├── tasks/ │   ├── ui/ │   └── PageStub.tsx │ ├── router.tsx ├── routeTree.gen.ts ├── styles.css └── main entry files

⚙️ Installation & Setup
1. Clone the repository
git clone <your-repo-url>cd team-compass
2. Install dependencies
npm install
(or if using Bun)
bun install
3. Configure environment variables
Create a .env file and add your Supabase credentials:
VITE_SUPABASE_URL=your_urlVITE_SUPABASE_ANON_KEY=your_key
4. Run the development server
npm run dev
5. Build for production
npm run build
6. Preview production build
npm run preview

🧪 Testing & Linting
Run linting:
npm run lint
Format code:
npm run format

📌 Future Improvements


Full backend logic implementation


Real-time task updates


Role-based access control


Advanced filtering and search


Notifications system


Mobile-first optimization



🤝 Contribution
Contributions are welcome. Feel free to fork the repository and submit pull requests to improve the platform.

📄 License
This project is intended for educational and development purposes.

💡 Summary
Team Compass is a scalable and modular team collaboration platform that combines task management, group organization, and modern UI practices into a single system—making it ideal for teams, student projects, and collaborative environments.
