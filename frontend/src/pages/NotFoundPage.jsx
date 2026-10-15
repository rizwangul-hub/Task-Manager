import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../components/layout/PageContainer';
import EmptyState from '../components/ui/EmptyState';
import { FileQuestion, Home } from 'lucide-react';

export const NotFoundPage = () => {
  const navigate = useNavigate();

  return (
    <PageContainer title="Page Not Found">
      <div className="placeholder-page-wrapper">
        <EmptyState
          icon={FileQuestion}
          title="404 - Page Not Found"
          description="The URL you navigated to does not exist within the PixxTechnologiees Task Manager application."
          actionLabel="Return to Dashboard"
          actionIcon={Home}
          onAction={() => navigate('/')}
        />
      </div>
    </PageContainer>
  );
};

export default NotFoundPage;
