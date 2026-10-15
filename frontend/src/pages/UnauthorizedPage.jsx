import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../components/layout/PageContainer';
import EmptyState from '../components/ui/EmptyState';
import { ShieldAlert, Home } from 'lucide-react';

export const UnauthorizedPage = () => {
  const navigate = useNavigate();

  return (
    <PageContainer title="Access Restricted">
      <div className="placeholder-page-wrapper">
        <EmptyState
          icon={ShieldAlert}
          title="403 - Permission Denied"
          description="Your current user role does not possess the required permissions to view this resource. Contact your organization administrator if you need expanded access."
          actionLabel="Return to Dashboard"
          actionIcon={Home}
          onAction={() => navigate('/')}
        />
      </div>
    </PageContainer>
  );
};

export default UnauthorizedPage;
